require('dotenv').config();
const { Site, Param, sequelize } = require('../models');

(async () => {
  try {
    const sites = await Site.findAll({
      include: [{ model: Param, as: 'params' }]
    });
    console.log(`Found ${sites.length} sites in DB:`);
    for (const s of sites) {
      if (s.siteCode.includes('PGI') || s.siteCode.includes('TALBROS') || s.name.includes('PGI') || s.name.includes('TALBROS')) {
        console.log(`\n========================================`);
        console.log(`Site ID: ${s.id} | Code: ${s.siteCode} | Name: ${s.name}`);
        console.log(`Parameters (${s.params.length}):`);
        s.params.forEach(p => {
          console.log(`  - Key: ${p.key} | PID: "${p.pid}" | Name: "${p.name}" | Value: ${p.value} | Signal: ${p.signal}`);
        });
      }
    }
    await sequelize.close();
  } catch (err) {
    console.error(err);
  }
})();
