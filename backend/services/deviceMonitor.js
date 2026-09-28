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

const OFFLINE_MIN = Number(process.env.OFFLINE_THRESHOLD_MINUTES || 3);

/* ------------------------------------------------------------
   Build a plain site object with every field the email
   templates need (plus params for the last-known-values list).
   ------------------------------------------------------------ */
function emailSiteShape(site, params = []) {
  const plain = site.toJSON ? site.toJSON() : site;
  return {
    id: plain.siteCode,
    name: plain.name,
    sector: plain.sector,
    loc: plain.loc,
    spcb: plain.spcb,
    contact: plain.contact,
    phone: plain.phone,
    notifyEmails: Array.isArray(plain.notifyEmails) ? plain.notifyEmails : [],
    params: params.map((p) => {
      const pp = p.toJSON ? p.toJSON() : p;
      return {
        key: pp.key,
        value: pp.value != null ? Number(pp.value) : null,
        unit: pp.unit || '',
        limit: pp.limit != null ? Number(pp.limit) : null,
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
      lastSeenAt: { [Op.lt]: cutoff, [Op.ne]: null },
    },
    include: [{ model: Param, as: 'params' }],
  });

  for (const site of stale) {
    const minutesOffline = Math.round(
      (now - new Date(site.lastSeenAt).getTime()) / 60_000
    );

    await site.update({
      connectivity: 'grey',
      signal: 'grey',
      lastData: `${minutesOffline}m ago`,
    });

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
    const params = site.params || [];
    const hasRed = params.some((p) => p.signal === 'red');

    await site.update({
      connectivity: 'live',
      signal: hasRed ? 'red' : 'green',
      lastData: 'just now',
    });

    await sendRecoveryEmail({
      site: emailSiteShape(site, params),
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

    logger.info(`🟢 Site ${site.siteCode} RECOVERED`);
  }

  return { offlineCount: stale.length, recoveredCount: recovered.length };
}

module.exports = { checkDevices, OFFLINE_MIN };