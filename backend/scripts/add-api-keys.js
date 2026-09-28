/* ============================================================
   scripts/add-api-keys.js
   Add api_key columns to users and sites tables.
   Run once: node scripts/add-api-keys.js
   ============================================================ */

require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Postgres');

    // Portal API key on users
    await sequelize.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS api_key VARCHAR(128) UNIQUE;
    `);
    console.log('✅ users.api_key added');

    // Logger API key on sites (replaces the global DEVICE_API_KEY model)
    await sequelize.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS logger_key VARCHAR(128) UNIQUE;
    `);
    console.log('✅ sites.logger_key added');

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  }
})();