require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    const [result] = await sequelize.query(`
      UPDATE params 
      SET value = NULL, 
          signal = 'grey', 
          history = '[]'::jsonb
      WHERE site_code = 'QH_TALBROS_IMT' AND pid = 'QHTALBROSIMT-PM-2';
    `);
    console.log('Reset QHTALBROSIMT-PM-2 result:', result);

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
