/* ========== Data model matching backend seed ========== */

import { pidFor, PARAMS } from './cpcb';

const SEED_SITES = [
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

function seedParam(key, scenario, siteId) {
  const n = PARAMS[key];
  if (!n) return null;
  const base = n.ph ? 7.4 : +(n.limit * 0.55).toFixed(1);
  const p = {
    key,
    pid: pidFor(siteId, key),
    unit: n.unit,
    limit: n.limit,
    min: n.min,
    value: base,
    yToday: 0,
    y30: 0,
    y30conn: 0,
    connHrs: 0,
    connFailHrsToday: 0,
    stableHrs: 0,
    excStreak: 0,
    redCount30: 0,
    phVal: n.ph ? 7.4 : null,
    history: [],
    signal: 'green',
  };
  for (let i = 0; i < 24; i++) {
    const v = n.ph
      ? +(7.2 + Math.sin(i / 3) * 0.2).toFixed(2)
      : +(n.limit * 0.55).toFixed(1);
    p.history.push(v);
  }
  return p;
}

export function buildSeedSites() {
  return SEED_SITES.map((s) => {
    const params = s.params.map((k) => seedParam(k, s.scenario, s.id)).filter(Boolean);
    return {
      ...s,
      params,
      connectivity: 'live',
      enabled: true,
      running: true,
      passcode: '1234',
      lastData: 'just now',
      signal: 'green',
    };
  });
}

export function buildSeedAlerts() {
  return [];
}

export function buildSeedComplaints() {
  return [
    {
      id: 'CMP-1001',
      siteId: 'TEST_2026',
      site: 'Test Industry — Demo Site',
      cat: 'Calibration',
      msg: 'Annual calibration check scheduled.',
      status: 'progress',
      by: 'Test Contact',
      time: Date.now() - 86400000,
    },
  ];
}

export function buildSeedServices(sites) {
  const now = Date.now();
  const day = 86400000;
  const map = {};
  sites.forEach((s) => {
    map[s.id] = {
      DTC: { start: now - 30 * day, expiry: now + 300 * day, package: 'dtc-y', history: [], suspended: false },
      'AMC|Gas Analyser':   { start: now - 30 * day, expiry: now + 52 * day, package: 'amc-y', history: [], suspended: false },
      'AMC|Water Analyser': { start: now - 30 * day, expiry: now + 120 * day, package: 'amc-y', history: [], suspended: false },
      'AMC|SPM':            { start: now - 30 * day, expiry: now + 90 * day, package: 'amc-y', history: [], suspended: false },
      'CMC|Gas Analyser':   { start: now - 30 * day, expiry: now + 200 * day, package: 'cmc-y', history: [], suspended: false },
      'CMC|Water Analyser': { start: now - 30 * day, expiry: now + 180 * day, package: 'cmc-y', history: [], suspended: false },
      'CMC|SPM':            { start: now - 30 * day, expiry: now + 240 * day, package: 'cmc-y', history: [], suspended: false },
    };
  });
  return map;
}

export const DEFAULT_PACKAGES = {
  DTC: { name: 'Data Transmission Charges', perEquip: false, tiers: [
    { id: 'dtc-q', label: 'Quarterly', months: 3, price: 9000 },
    { id: 'dtc-h', label: 'Half-Yearly', months: 6, price: 16500 },
    { id: 'dtc-y', label: 'Annual', months: 12, price: 30000 },
    { id: 'dtc-2y', label: '2-Year', months: 24, price: 54000 },
  ]},
  AMC: { name: 'Annual Maintenance', perEquip: true, tiers: [
    { id: 'amc-y', label: 'Annual (AMC)', months: 12, price: 45000 },
    { id: 'amc-2y', label: '2-Year (AMC)', months: 24, price: 82000 },
    { id: 'amc-3y', label: '3-Year (AMC)', months: 36, price: 115000 },
  ]},
  CMC: { name: 'Comprehensive Maintenance', perEquip: true, tiers: [
    { id: 'cmc-y', label: 'Annual (CMC)', months: 12, price: 70000 },
    { id: 'cmc-2y', label: '2-Year (CMC)', months: 24, price: 130000 },
    { id: 'cmc-3y', label: '3-Year (CMC)', months: 36, price: 185000 },
  ]},
};