const cron = require('node-cron');
const { checkDevices } = require('../services/deviceMonitor');
const logger = require('../utils/logger');

/* ============================================================
   Scheduled jobs
   - Device monitor runs every N minutes (default 1)
   - Reads OFFLINE_THRESHOLD_MINUTES + MONITOR_INTERVAL_MINUTES from .env
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
}

module.exports = { startCronJobs };