/* ============================================================
   Seed runner — callable from server.js (no process.exit)
   Uses ONLY the TEST_2026 dummy site for testing.
   Restore the real 8 sites by uncommenting the block below.
   ============================================================ */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Site = require('../models/Site');
const Complaint = require('../models/Complaint');
const ServiceContract = require('../models/ServiceContract');
const logger = require('./logger');
const PARAMS = require('./paramRegistry');

function pidFor(siteId, key) {
  const suffix = PARAMS[key].pid.replace(/^P-/, '');
  return `${siteId.toUpperCase()}-${suffix}`;
}

function seedParam(key, scenario) {
  const def = PARAMS[key];
  const base = def.ph ? 7.4 : def.limit * 0.55;
  const p = {
    key,
    pid: '',
    unit: def.unit,
    limit: def.limit,
    min: def.min ?? null,
    value: def.ph ? +base.toFixed(2) : +base.toFixed(1),
    phVal: def.ph ? +base.toFixed(2) : null,
    signal: 'green',
    yToday: 0, y30: 0, y30conn: 0, connHrs: 0,
    connFailHrsToday: 0, stableHrs: 0, excStreak: 0,
    redCount30: 0, history: [],
  };
  for (let i = 0; i < 24; i++) {
    const v = def.ph
      ? 7.2 + Math.sin(i / 3) * 0.4
      : def.limit * (0.45 + Math.random() * 0.25);
    p.history.push(+v.toFixed(2));
  }
  if (scenario === 'yellow' && Math.random() < 0.5) {
    p.yToday = 2;
    p.value = +(def.limit * 1.15).toFixed(1);
  }
  if (scenario === 'orange' && Math.random() < 0.5) {
    p.y30 = 29;
    p.excStreak = 4;
    p.value = +(def.limit * 1.3).toFixed(1);
  }
  if (scenario === 'red' && Math.random() < 0.45) {
    p.y30 = 56;
    p.excStreak = 8;
    p.value = +(def.limit * 1.5).toFixed(1);
  }
  if (scenario === 'purple' && key === 'pH') {
    p.phVal = 3.6;
    p.value = 3.6;
    p.redCount30 = 2;
  }
  return p;
}

/* ============================================================
   Sites to seed
   ------------------------------------------------------------
   The 8 demo industries are commented out. Only TEST_2026 is
   active. Uncomment the block below to bring the 8 back.
   ============================================================ */
const SEED_SITES = [
  /* ---------------- Commented out for now ----------------
  { id: 'ESK-4417', name: 'Escorts Kubota Limited', sector: 'Auto Components', loc: 'Faridabad, HR', lat: 28.42, lng: 77.31, spcb: 'HSPCB', category: '17-Category', stacks: 2, etp: 1, contact: 'Sh. R. Malhotra', phone: '98100 12345', ganga: false, params: ['PM', 'SO2', 'NOx', 'Flow', 'Temperature'], scenario: 'red' },
  { id: 'KRK-0392', name: 'KRKA Pulp & Paper', sector: 'Pulp & Paper', loc: 'Yamunanagar, HR', lat: 30.13, lng: 77.28, spcb: 'HSPCB', category: '17-Category', stacks: 1, etp: 1, contact: 'Dr. S. Rao', phone: '98100 23456', ganga: true, params: ['PM', 'COD', 'BOD', 'pH', 'TSS'], scenario: 'orange' },
  { id: 'NCW-0288', name: 'Northern Cement Works', sector: 'Cement', loc: 'Charkhi Dadri, HR', lat: 28.59, lng: 76.27, spcb: 'HSPCB', category: '17-Category', stacks: 1, etp: 0, contact: 'Er. A. Sethi', phone: '98100 34567', ganga: false, params: ['PM', 'SO2', 'NOx'], scenario: 'green' },
  { id: 'GTM-0511', name: 'Ganga Textiles Mills', sector: 'Textiles', loc: 'Panipat, HR', lat: 29.39, lng: 76.97, spcb: 'HSPCB', category: 'GPI in Ganga', stacks: 1, etp: 1, contact: 'Ms. P. Sharma', phone: '98100 45678', ganga: true, params: ['PM', 'COD', 'pH', 'TSS'], scenario: 'yellow' },
  { id: 'YSD-0623', name: 'Yamuna Steel & Alloys', sector: 'Iron & Steel', loc: 'Hisar, HR', lat: 29.15, lng: 75.72, spcb: 'HSPCB', category: '17-Category', stacks: 3, etp: 1, contact: 'Sh. V. Kumar', phone: '98100 56789', ganga: false, params: ['PM', 'SO2', 'NOx', 'CO', 'Flow'], scenario: 'green' },
  { id: 'ATP-0705', name: 'Apex Thermal Power Stn.', sector: 'Power', loc: 'Yamunanagar, HR', lat: 30.1, lng: 77.4, spcb: 'HSPCB', category: '17-Category', stacks: 2, etp: 1, contact: 'Er. M. Iyer', phone: '98100 67890', ganga: false, params: ['PM', 'SO2', 'NOx', 'Flow', 'Temperature'], scenario: 'delay' },
  { id: 'DPF-0819', name: 'Deccan Pharma Formulations', sector: 'Pharma', loc: 'Baddi, HP', lat: 30.96, lng: 76.79, spcb: 'HPPCB', category: '17-Category', stacks: 1, etp: 1, contact: 'Dr. N. Verma', phone: '98100 78901', ganga: false, params: ['PM', 'COD', 'BOD', 'pH'], scenario: 'green' },
  { id: 'MSR-0940', name: 'Meenakshi Solvent Refinery', sector: 'Chemical', loc: 'Rohtak, HR', lat: 28.9, lng: 76.6, spcb: 'HSPCB', category: '17-Category', stacks: 2, etp: 1, contact: 'Sh. D. Mehta', phone: '98100 89012', ganga: false, params: ['PM', 'SO2', 'NOx', 'COD', 'pH'], scenario: 'purple' },
  ---------------- end of commented sites ---------------- */

  /* ---- Single dummy site for testing ---- */
  {
    id: 'TEST_2026',
    name: 'Test Industry — Demo Site',
    sector: 'Demo / Testing',
    loc: 'New Delhi, DL',
    lat: 28.6139,
    lng: 77.2090,
    spcb: 'DPCC',
    category: '17-Category',
    stacks: 1,
    etp: 1,
    contact: 'Test Contact',
    phone: '9810000000',
    ganga: false,
    params: ['PM', 'SO2', 'NOx', 'pH', 'COD'],
    scenario: 'green',
  },
];

module.exports = async function runSeed() {
  /* Wipe everything first (defensive — in case of stale in-memory data) */
  await Promise.all([
    User.deleteMany({}),
    Site.deleteMany({}),
    Complaint.deleteMany({}),
    ServiceContract.deleteMany({}),
    mongoose.connection.collection('readings').deleteMany({}),
    mongoose.connection.collection('alerts').deleteMany({}),
  ]);

  /* ---------- Users ---------- */
  await User.create([
    {
      name: 'Saaphzone Technologies',
      role: 'admin',
      login: 'admin',
      passwordHash: await bcrypt.hash('Rn4$KpV9!TzL3wXq', 10),
    },
    {
      name: 'Chandan',
      role: 'engineer',
      login: 'chandan',
      mobile: '9818536015',
      passwordHash: await bcrypt.hash('Dm8#WcF2@Ys6PbH5', 10),
    },
    {
      name: 'Saaphzone Technologies',
      role: 'sales',
      login: 'sales',
      passwordHash: await bcrypt.hash('Qz5!Nt7#GxR2VkM9', 10),
    },
  ]);

  /* ---------- Sites ---------- */
  const sites = SEED_SITES.map((s) => {
    const params = s.params.map((k) => {
      const p = seedParam(k, s.scenario);
      p.pid = pidFor(s.id, k);
      p.name = p.name || (k + ' — ' + s.name);       // custom display name
      p.signal =
        s.scenario === 'red' || s.scenario === 'purple' ? 'red'
        : s.scenario === 'orange' ? 'orange'
        : s.scenario === 'yellow' ? 'yellow'
        : 'green';
      return p;
    });

    return {
      ...s,
      passcode: 'indus_1234',
      params,
      connectivity: s.scenario === 'delay' ? 'delay' : 'live',
      enabled: true,
      running: true,
      lastData: s.scenario === 'delay' ? '4h 12m ago' : 'just now',
      lastSeenAt:
        s.scenario === 'delay'
          ? new Date(Date.now() - 4 * 3600 * 1000)
          : new Date(),
      signal:
        s.scenario === 'red' || s.scenario === 'purple' ? 'red'
        : s.scenario === 'orange' ? 'orange'
        : s.scenario === 'yellow' ? 'yellow'
        : s.scenario === 'delay' ? 'delay'
        : 'green',
    };
  });
  await Site.insertMany(sites);

  /* ---------- Complaints ----------
     Disabled while only the dummy site exists. */
  /*
  await Complaint.insertMany([
    { siteId: 'KRK-0392', site: 'KRKA Pulp & Paper', cat: 'Calibration', msg: 'COD analyzer reading drifting after last service — please recalibrate.', status: 'progress', by: 'Dr. S. Rao', time: new Date(Date.now() - 2 * 86400000) },
    { siteId: 'ATP-0705', site: 'Apex Thermal Power Stn.', cat: 'Connectivity', msg: 'Data feed delayed since morning, GPRS modem may be down.', status: 'open', by: 'Er. M. Iyer', time: new Date(Date.now() - 6 * 3600000) },
  ]);
  */

  /* ---------- Service Contracts ----------
     Disabled while only the dummy site exists. */
  /*
  const now = Date.now();
  const day = 86400000;
  const contracts = [];
  sites.forEach((s, idx) => {
    const expiryOffsets = {
      DTC: 300,
      'AMC|Gas Analyser': 52,
      'AMC|Water Analyser': 120,
      'AMC|SPM': idx === 3 ? 4 : 90,
      'CMC|Gas Analyser': 200,
      'CMC|Water Analyser': idx === 7 ? 6 : 180,
      'CMC|SPM': idx === 0 ? -5 : 240,
    };
    Object.entries(expiryOffsets).forEach(([key, offset]) => {
      contracts.push({
        siteId: s.id, key,
        start: new Date(now - 30 * day),
        expiry: new Date(now + offset * day),
        package: key.startsWith('DTC') ? 'dtc-y' : key.startsWith('AMC') ? 'amc-y' : 'cmc-y',
        suspended: false, history: [],
      });
    });
  });
  await ServiceContract.insertMany(contracts);
  */

  logger.info('✅ Seed complete');
  logger.info(`   ${SEED_SITES.length} site(s)`);
  logger.info('   3 users (admin / chandan / sales)');
  logger.info('   industry passcode = 1234');
};