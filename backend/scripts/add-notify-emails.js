/* ============================================================
   scripts/add-notify-emails.js
   One-time migration: add notify_emails column to sites table.
   Run once: node scripts/add-notify-emails.js
   ============================================================ */

require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Postgres');

    // Add column if it doesn't exist
    await sequelize.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS notify_emails JSONB DEFAULT '[]'::jsonb;
    `);

    console.log('✅ notify_emails column added (or already existed)');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  }
})();