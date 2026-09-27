/* ============================================================
   scripts/fix-alerts.js
   Creates the missing `alerts` table in PostgreSQL.
   Run once: node scripts/fix-alerts.js
   ============================================================ */

require('dotenv').config();
const { sequelize, Alert } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Postgres');

    await Alert.sync({ force: true });
    console.log('✅ alerts table created');

    const [rows] = await sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log('Tables now present:');
    rows.forEach((r) => console.log('   - ' + r.table_name));

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ FAILED:', e.message);
    if (e.original) console.error('   Original:', e.original.message);
    process.exit(1);
  }
})();