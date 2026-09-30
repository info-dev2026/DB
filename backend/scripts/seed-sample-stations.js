require('dotenv').config();
const { Site, Param, sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Connected to DB');

    const sampleDate = new Date('2026-06-26T17:19:00+05:30');

    // 1. Water Analyzer (854)
    let s854 = await Site.findOne({ where: { siteCode: '854' } });
    if (!s854) {
      s854 = await Site.create({
        siteCode: '854',
        name: 'Water Analyzer',
        deviceType: 'Water Analyzer',
        sector: 'Chemicals / Water Treatment',
        loc: 'Panipat Industrial Area, Haryana',
        lat: 29.3909,
        lng: 76.9635,
        spcb: 'HSPCB',
        category: '17-Category',
        passcode: 'sz854pass',
        createdAt: sampleDate,
        updatedAt: sampleDate,
      });

      await Param.bulkCreate([
        { siteCode: '854', key: 'pH', name: 'Water Analyzer pH', pid: '854-PH', unit: '', limit: 8.5, min: 6.5, value: 7.35, signal: 'green' },
        { siteCode: '854', key: 'BOD', name: 'Water Analyzer BOD', pid: '854-BOD', unit: 'mg/L', limit: 30, value: 18.4, signal: 'green' },
        { siteCode: '854', key: 'COD', name: 'Water Analyzer COD', pid: '854-COD', unit: 'mg/L', limit: 250, value: 112.0, signal: 'green' },
        { siteCode: '854', key: 'TSS', name: 'Water Analyzer TSS', pid: '854-TSS', unit: 'mg/L', limit: 100, value: 42.6, signal: 'green' },
      ]);
      console.log('✅ Created station 854: Water Analyzer');
    }

    // 2. Water Analyzer Inlet (855)
    let s855 = await Site.findOne({ where: { siteCode: '855' } });
    if (!s855) {
      s855 = await Site.create({
        siteCode: '855',
        name: 'Water Analyzer Inlet',
        deviceType: 'Water Analyzer Inlet',
        sector: 'Chemicals / Water Treatment',
        loc: 'Inlet Raw Effluent Section, Haryana',
        lat: 29.3915,
        lng: 76.9642,
        spcb: 'HSPCB',
        category: '17-Category',
        passcode: 'sz855pass',
        createdAt: sampleDate,
        updatedAt: sampleDate,
      });

      await Param.bulkCreate([
        { siteCode: '855', key: 'pH', name: 'Inlet pH', pid: '855-PH-INLET', unit: '', limit: 8.5, min: 6.5, value: 7.12, signal: 'green' },
        { siteCode: '855', key: 'BOD', name: 'Inlet BOD', pid: '855-BOD-INLET', unit: 'mg/L', limit: 30, value: 24.5, signal: 'green' },
        { siteCode: '855', key: 'COD', name: 'Inlet COD', pid: '855-COD-INLET', unit: 'mg/L', limit: 250, value: 165.0, signal: 'green' },
        { siteCode: '855', key: 'TSS', name: 'Inlet TSS', pid: '855-TSS-INLET', unit: 'mg/L', limit: 100, value: 58.2, signal: 'green' },
      ]);
      console.log('✅ Created station 855: Water Analyzer Inlet');
    }

    // 3. AAQMS (856)
    let s856 = await Site.findOne({ where: { siteCode: '856' } });
    if (!s856) {
      s856 = await Site.create({
        siteCode: '856',
        name: 'AAQMS',
        deviceType: 'AAQMS',
        sector: 'Ambient Air Quality Monitoring',
        loc: 'Perimeter Ambient Monitoring Station, Panipat',
        lat: 29.3922,
        lng: 76.9655,
        spcb: 'HSPCB',
        category: '17-Category',
        passcode: 'sz856pass',
        createdAt: sampleDate,
        updatedAt: sampleDate,
      });

      await Param.bulkCreate([
        { siteCode: '856', key: 'PM2.5', name: 'PM2.5', pid: '856-PM25', unit: 'µg/m³', limit: 60, value: 38.5, signal: 'green' },
        { siteCode: '856', key: 'PM10', name: 'PM10', pid: '856-PM10', unit: 'µg/m³', limit: 100, value: 74.2, signal: 'green' },
        { siteCode: '856', key: 'Temperature', name: 'Temperature', pid: '856-TEMP', unit: '°C', limit: 50, value: 29.4, signal: 'green' },
        { siteCode: '856', key: 'Humidity', name: 'Humidity', pid: '856-HUM', unit: '%', limit: 100, value: 54.0, signal: 'green' },
      ]);
      console.log('✅ Created station 856: AAQMS (PM2.5, PM10, Temperature, Humidity)');
    }

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('Error seeding sample stations:', e);
    process.exit(1);
  }
})();
