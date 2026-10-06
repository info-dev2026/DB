require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    const [rows] = await sequelize.query(`
      SELECT *
      FROM readings 
      WHERE site_code = 'QH_TALBROS_IMT'
      ORDER BY id DESC 
      LIMIT 10;
    `);
    console.log('Recent readings for QH_TALBROS_IMT:');
    console.table(rows);
    await sequelize.close();
  } catch (err) {
    console.error('Error:', err);
  }
})();
