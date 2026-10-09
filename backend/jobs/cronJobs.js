const cron = require('node-cron');
const { checkDevices } = require('../services/deviceMonitor');
const { triggerCpcbAutoPush } = require('../services/cpcbAutoPusher');
const logger = require('../utils/logger');

/* ============================================================
   Scheduled jobs
   - Device monitor runs every N minutes (default 1)
   - CPCB OCEMS Auto-Push runs every 15 minutes (default 15)
   ============================================================ */
function startCronJobs() {
  const minutes = Math.max(1, Number(process.env.MONITOR_INTERVAL_MINUTES || 1));

  cron.schedule(`*/${minutes} * * * *`, async () => {
    try {
      const r = await checkDevices();
      if (r.offlineCount || r.recoveredCount) {
        logger.info(
          `📡 monitor: ${r.offlineCount} offline · ${r.recoveredCount} recovered`
        );
      }
    } catch (e) {
      logger.error('Cron checkDevices error: ' + e.message);
    }
  });

  logger.info(
    `⏰ Cron: device monitor every ${minutes} min ` +
    `(offline threshold = ${process.env.OFFLINE_THRESHOLD_MINUTES || 3} min)`
  );

  /* ---------- CPCB 15-Minute Auto-Push Job ---------- */
  const cpcbMinutes = Math.max(1, Number(process.env.CPCB_PUSH_INTERVAL_MINUTES || 15));
  cron.schedule(`*/${cpcbMinutes} * * * *`, async () => {
    try {
      logger.info(`⏰ [CRON] Starting ${cpcbMinutes}-minute CPCB auto-transmission cycle...`);
      const summary = await triggerCpcbAutoPush();
      if (summary.processedCount > 0) {
        logger.info(
          `🚀 CPCB Auto-Push: Transmitted ${summary.successCount}/${summary.processedCount} configured sites.`
        );
      }
    } catch (e) {
      logger.error('CPCB Auto-Push cron error: ' + e.message);
    }
  });

  logger.info(`⏰ Cron: CPCB auto-push scheduled every ${cpcbMinutes} min (to cems.cpcb.gov.in)`);

  // Schedule initial transmission check aligned with the next 15-minute boundary so CPCB accepts the packet
  const nowMs = Date.now();
  const slotMs = 15 * 60 * 1000;
  const nextSlotBoundary = Math.ceil(nowMs / slotMs) * slotMs + 2000;
  const msUntilBoundary = Math.max(2000, nextSlotBoundary - nowMs);
  const isAtBoundary = (msUntilBoundary <= 5000 || msUntilBoundary >= slotMs - 45000);
  const initialDelayMs = isAtBoundary ? 2000 : msUntilBoundary;

  setTimeout(async () => {
    try {
      logger.info('⏰ [CRON BOOT] Performing transmission check at 15-min slot boundary for configured regulatory sites...');
      const summary = await triggerCpcbAutoPush();
      if (summary.processedCount > 0) {
        logger.info(
          `🚀 [CRON BOOT] Transmitted ${summary.successCount}/${summary.processedCount} configured sites.`
        );
      }
    } catch (e) {
      logger.warn('[CRON BOOT] Initial auto-push check: ' + e.message);
    }
  }, initialDelayMs);
}

/* On-demand trigger when user adds details or tests a site */
async function triggerSiteCronNow(siteCode = null, boardCode = null) {
  try {
    logger.info(`⏰ [ON-DEMAND CRON] Triggering immediate transmission cycle for ${siteCode || 'all sites'} [${boardCode || 'all boards'}]...`);
    return await triggerCpcbAutoPush(siteCode, boardCode);
  } catch (e) {
    logger.error('On-demand regulatory cron error: ' + e.message);
    throw e;
  }
}

module.exports = { startCronJobs, triggerSiteCronNow };