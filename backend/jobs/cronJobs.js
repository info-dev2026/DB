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
}

module.exports = { startCronJobs };