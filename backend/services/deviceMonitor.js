const Site = require('../models/Site');
const Alert = require('../models/Alert');
const logger = require('../utils/logger');
const { sendDeviceOfflineEmail, sendRecoveryEmail } = require('./emailService');
const { broadcast, toSite, toAdmins } = require('./socketService');

const OFFLINE_MIN = Number(process.env.OFFLINE_THRESHOLD_MINUTES || 3);

/* ============================================================
   Runs every 1 minute.
   1. Detects sites whose lastSeenAt is older than OFFLINE_MIN
   2. Marks them offline, creates alert, sends email, pushes socket
   3. Detects recovery and sends the "back online" notification
   ============================================================ */
async function checkDevices() {
  const now = Date.now();
  const cutoff = new Date(now - OFFLINE_MIN * 60_000);

  /* ---- 1) Sites that were live but have gone silent ---- */
  const stale = await Site.find({
    running: true,
    enabled: true,
    connectivity: { $ne: 'grey' },
    lastSeenAt: { $lt: cutoff, $ne: null },
  });

  for (const site of stale) {
    const minutesOffline = Math.round(
      (now - new Date(site.lastSeenAt).getTime()) / 60_000
    );

    site.connectivity = 'grey';
    site.signal = 'grey';
    site.lastData = `${minutesOffline}m ago`;
    await site.save();

    const alertDoc = await Alert.create({
      siteId: site.id,
      site: site.name,
      param: 'DEVICE',
      level: 'grey',
      reason: `No data for ${minutesOffline} minutes`,
    });

    /* 1. Send email */
    const ok = await sendDeviceOfflineEmail({
      site,
      minutesOffline,
      lastSeen: site.lastSeenAt,
    });
    if (ok) {
      alertDoc.emailed = true;
      await alertDoc.save();
    }

    /* 2. Push to browsers */
    broadcast('alert:new', alertDoc.toObject());
    broadcast('device:offline', {
      siteId: site.id,
      site: site.name,
      minutesOffline,
      lastSeen: site.lastSeenAt,
      ts: now,
    }, 'admins');
    toSite(site.id, 'device:offline', {
      siteId: site.id,
      site: site.name,
      minutesOffline,
      lastSeen: site.lastSeenAt,
      ts: now,
    });

    logger.warn(
      `🔴 Site ${site.id} OFFLINE for ${minutesOffline} min — email ${ok ? 'sent' : 'failed'}`
    );
  }

  /* ---- 2) Sites that were grey but have come back ---- */
  const recovered = await Site.find({
    running: true,
    enabled: true,
    connectivity: 'grey',
    lastSeenAt: { $gte: cutoff },
  });

  for (const site of recovered) {
    site.connectivity = 'live';
    site.signal =
      site.params.some((p) => p.signal === 'red') ? 'red' : 'green';
    site.lastData = 'just now';
    await site.save();

    await sendRecoveryEmail({ site, minutesOffline: OFFLINE_MIN });

    broadcast('device:online', { siteId: site.id, site: site.name, ts: now }, 'admins');
    toSite(site.id, 'device:online', { siteId: site.id, site: site.name, ts: now });

    logger.info(`🟢 Site ${site.id} RECOVERED`);
  }

  return { offlineCount: stale.length, recoveredCount: recovered.length };
}

module.exports = { checkDevices, OFFLINE_MIN };