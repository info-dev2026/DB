require('dotenv').config();
const { sequelize, Param, Site } = require('../models');

(async () => {
  try {
    const [cols] = await sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'params';");
    console.log('Param columns in DB:', cols.map(c => c.column_name).join(', '));
    const sites = await Site.findAll({ where: { siteCode: 'QH_TALBROS_IMT' }, include: [{ model: Param, as: 'params' }] });
    if (!sites.length) {
      console.log('Site QH_TALBROS_IMT not found');
    } else {
      console.log('Found QH_TALBROS_IMT:');
      sites[0].params.forEach(p => {
        console.log(`- id=${p.id}, key=${p.key}, pid=${p.pid}, name=${p.name}, value=${p.value}, signal=${p.signal}, limit=${p.limit}`);
      });
    }
    await sequelize.close();
  } catch (err) {
    console.error('DB Error:', err);
  }
})();
