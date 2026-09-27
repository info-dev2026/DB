/* ============================================================
   scripts/migrate.js
   One-time setup: creates all tables in PostgreSQL from the
   Sequelize model definitions.

   Usage:
     node scripts/migrate.js              → creates tables if missing
     node scripts/migrate.js --force      → DROPS + recreates (destroys data!)
     node scripts/migrate.js --status     → shows table list
   ============================================================ */

require('dotenv').config();
const { sequelize } = require('../models');
const logger = require('../utils/logger');

const force = process.argv.includes('--force');
const statusOnly = process.argv.includes('--status');

(async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ Connected to Postgres');

    if (statusOnly) {
      const [rows] = await sequelize.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      logger.info('Tables in "public" schema:');
      rows.forEach((r) => logger.info('   - ' + r.table_name));
      await sequelize.close();
      process.exit(0);
    }

    if (force) {
      logger.warn('⚠️  --force flag set: DROPPING all tables and recreating');
    }

    logger.info(force ? '🔄 Syncing (force)...' : '🔄 Syncing (safe)...');

    await sequelize.sync({ force, alter: false });

    logger.info('✅ Tables created/updated');

    const [rows] = await sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    logger.info('Tables now present:');
    rows.forEach((r) => logger.info('   - ' + r.table_name));

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    logger.error('❌ Migration failed: ' + e.message);
    console.error(e);
    process.exit(1);
  }
})();