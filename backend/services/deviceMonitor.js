/* ============================================================
   services/deviceMonitor.js — Sequelize version
   Runs every minute: detects offline sites, creates alerts,
   sends emails, pushes socket events. Also detects recovery.

   Emails are sent to site.notifyEmails (per-site list).
   Sites with no notifyEmails are silently skipped.
   ============================================================ */

const { Op } = require('sequelize');
const { Site, Param, Alert } = require('../models');
const logger = require('../utils/logger');
const { sendDeviceOfflineEmail, sendRecoveryEmail } = require('./emailService');
const { broadcast, toSite, toAdmins } = require('./socketService');
const { gradeParameter, rollup } = require('./cpcbEngine');

const OFFLINE_MIN = Number(process.env.OFFLINE_THRESHOLD_MINUTES || 30);

/* ------------------------------------------------------------
   Build a plain site object with every field the email
   templates need (plus params for the last-known-values list).
   ------------------------------------------------------------ */
function emailSiteShape(site, params = []) {
  const plain = site.toJSON ? site.toJSON() : site;
  return {
    id: plain.siteCode,
    name: plain.name,
    deviceType: plain.deviceType || plain.device_type || 'Analyzer',
    sector: plain.sector,
    loc: plain.loc,
    spcb: plain.spcb,
    contact: plain.contact,
    phone: plain.phone,
    email: plain.email || '',
    notifyEmails: Array.isArray(plain.notifyEmails) ? plain.notifyEmails : [],
    params: params.map((p) => {
      const pp = p.toJSON ? p.toJSON() : p;
      const raw = pp.value;
      const isNa = raw === 'NA' || raw === null || raw === undefined || Number.isNaN(Number(raw));
      return {
        key: pp.key,
        value: isNa ? 'NA' : Number(raw),
        unit: pp.unit || '',
        limit: pp.limit != null && !Number.isNaN(Number(pp.limit)) ? Number(pp.limit) : null,
      };
    }),
  };
}


async function checkDevices() {
  const now = Date.now();
  const cutoff = new Date(now - OFFLINE_MIN * 60_000);

  /* ---------- 1) Sites that went silent ---------- */
  const stale = await Site.findAll({
    where: {
      running: true,
      enabled: true,
      connectivity: { [Op.ne]: 'grey' },
      [Op.or]: [
        { lastSeenAt: { [Op.lt]: cutoff, [Op.ne]: null } },
        { lastSeenAt: null, createdAt: { [Op.lt]: cutoff } },
      ],
    },
    include: [{ model: Param, as: 'params' }],
  });

  for (const site of stale) {
    const lastSeenTime = site.lastSeenAt
      ? new Date(site.lastSeenAt).getTime()
      : site.createdAt
      ? new Date(site.createdAt).getTime()
      : now - OFFLINE_MIN * 60_000;
    const minutesOffline = Math.max(OFFLINE_MIN, Math.round((now - lastSeenTime) / 60_000));

    await site.update({
      connectivity: 'grey',
      signal: 'grey',
      lastData: `${minutesOffline}m ago`,
    });

    await Param.update(
      { signal: 'grey' },
      { where: { siteCode: site.siteCode } }
    );

    const alertDoc = await Alert.create({
      siteCode: site.siteCode,
      siteName: site.name,
      param: 'DEVICE',
      level: 'grey',
      reason: `No data for ${minutesOffline} minutes`,
      ts: new Date(),
    });

    /* ---------- Email (per-site recipients) ---------- */
    const ok = await sendDeviceOfflineEmail({
      site: emailSiteShape(site, site.params || []),
      minutesOffline,
      lastSeen: site.lastSeenAt,
    });
    if (ok) {
      await alertDoc.update({ emailed: true });
    }

    /* ---------- Sockets ---------- */
    const alertJSON = {
      _id: String(alertDoc.id),
      siteId: site.siteCode,
      site: site.name,
      param: 'DEVICE',
      level: 'grey',
      reason: alertDoc.reason,
      acknowledged: false,
      ts: alertDoc.ts,
    };

    broadcast('alert:new', alertJSON);
    broadcast(
      'device:offline',
      {
        siteId: site.siteCode,
        site: site.name,
        minutesOffline,
        lastSeen: site.lastSeenAt,
        ts: now,
      },
      'admins'
    );
    toSite(site.siteCode, 'device:offline', {
      siteId: site.siteCode,
      site: site.name,
      minutesOffline,
      lastSeen: site.lastSeenAt,
      ts: now,
    });

    // Also broadcast site:update so site list and KPI bars update in real time
    broadcast('site:update', {
      siteId: site.siteCode,
      signal: 'grey',
      connectivity: 'grey',
      lastData: `${minutesOffline}m ago`,
      lastSeenAt: site.lastSeenAt,
      params: (site.params || []).map((p) => {
        const plain = p.toJSON ? p.toJSON() : p;
        return { ...plain, signal: 'grey', hasReceivedData: false };
      }),
    });

    logger.warn(
      `🔴 Site ${site.siteCode} OFFLINE for ${minutesOffline} min — email ${
        ok ? 'sent' : 'skipped/failed'
      }`
    );
  }

  /* ---------- 2) Sites that recovered ---------- */
  const recovered = await Site.findAll({
    where: {
      running: true,
      enabled: true,
      connectivity: 'grey',
      lastSeenAt: { [Op.gte]: cutoff },
    },
    include: [{ model: Param, as: 'params' }],
  });

  for (const site of recovered) {
    const rawParams = site.params || [];
    const updatedParams = rawParams.map((p) => {
      const plain = p.toJSON ? p.toJSON() : p;
      const hasValue = plain.value != null && !isNaN(Number(plain.value));
      const paramSig = hasValue
        ? (plain.signal && plain.signal !== 'grey' ? plain.signal : gradeParameter(plain))
        : 'grey';
      return { ...plain, signal: paramSig };
    });

    const newSignal = rollup(updatedParams, 'live', site.enabled);

    await site.update({
      connectivity: 'live',
      signal: newSignal,
      lastData: 'just now',
    });

    // Also update any params that had values from grey to their compliance grade
    for (const p of rawParams) {
      const plain = p.toJSON ? p.toJSON() : p;
      if (plain.value != null && !isNaN(Number(plain.value)) && plain.signal === 'grey') {
        await p.update({ signal: gradeParameter(plain) });
      }
    }

    await sendRecoveryEmail({
      site: emailSiteShape(site, rawParams),
      minutesOffline: OFFLINE_MIN,
    });

    broadcast(
      'device:online',
      { siteId: site.siteCode, site: site.name, ts: now },
      'admins'
    );
    toSite(site.siteCode, 'device:online', {
      siteId: site.siteCode,
      site: site.name,
      ts: now,
    });

    broadcast('site:update', {
      siteId: site.siteCode,
      signal: newSignal,
      connectivity: 'live',
      lastData: 'just now',
      lastSeenAt: site.lastSeenAt,
      params: updatedParams,
    });

    logger.info(`🟢 Site ${site.siteCode} RECOVERED`);
  }

  return { offlineCount: stale.length, recoveredCount: recovered.length };
}

module.exports = { checkDevices, OFFLINE_MIN };