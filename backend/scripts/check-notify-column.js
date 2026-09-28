/* ============================================================
   scripts/check-notify-column.js
   Verify the notify_emails column exists on the sites table.
   Run: node scripts/check-notify-column.js
   ============================================================ */

require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Postgres');

    const [rows] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'sites' AND column_name = 'notify_emails';
    `);

    if (rows.length === 0) {
      console.log('❌ notify_emails column NOT found');
    } else {
      console.log('✅ notify_emails column exists:');
      console.table(rows);
    }

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();