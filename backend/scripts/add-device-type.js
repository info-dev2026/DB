require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Connected to Postgres');

    await sequelize.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS device_type VARCHAR(100) DEFAULT NULL;
    `);
    console.log('✅ device_type column added to sites table');

    const [cols] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'sites';
    `);
    console.log('Columns on sites:', cols.map(c => c.column_name));

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  }
})();
