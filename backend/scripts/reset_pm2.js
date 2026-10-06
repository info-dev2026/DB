require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.query(`
      UPDATE params 
      SET value = NULL, 
          signal = 'grey', 
          history = '[]'::jsonb,
          name = 'Stack 2 PM'
      WHERE site_code = 'QH_TALBROS_IMT' AND pid = 'QHTALBROSIMT-PM-2';
    `);

    await sequelize.query(`
      UPDATE params 
      SET name = 'Stack 1 PM'
      WHERE site_code = 'QH_TALBROS_IMT' AND pid = 'QHTALBROSIMT-PM';
    `);

    const [rows] = await sequelize.query(`
      SELECT id, key, pid, name, value, signal, history 
      FROM params 
      WHERE site_code = 'QH_TALBROS_IMT';
    `);
    console.log('Current params for QH_TALBROS_IMT in DB:', rows);

    await sequelize.close();
  } catch (err) {
    console.error('Error resetting PM-2:', err);
  }
})();
