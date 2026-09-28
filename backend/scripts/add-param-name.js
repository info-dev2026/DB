/* ============================================================
   scripts/add-param-name.js
   One-time migration: add name column to params table.
   Run: node scripts/add-param-name.js
   ============================================================ */

require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Postgres');

    // Check existing columns
    const [existing] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'params';
    `);
    console.log('Existing columns on params table:', existing.map(r => r.column_name));

    // Add column if it doesn't exist
    await sequelize.query(`
      ALTER TABLE params
      ADD COLUMN IF NOT EXISTS name VARCHAR(150) DEFAULT NULL;
    `);

    console.log('✅ name column added to params table (or already existed)');

    const [updated] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'params' AND column_name = 'name';
    `);
    console.table(updated);

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  }
})();
