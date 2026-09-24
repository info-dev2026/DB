/* ========== Mock data for local UI development ==========
   Replace with real API calls when the backend is live. */

import { gradeParameter, rollup, pidFor, PARAMS } from './cpcb';
import { rid } from './formatters';

const SEED_SITES = [
  { id: 'ESK-4417', name: 'Escorts Kubota Limited', sector: 'Auto Components', loc: 'Faridabad, HR', lat: 28.42, lng: 77.31, spcb: 'HSPCB', category: '17-Category', stacks: 2, etp: 1, contact: 'Sh. R. Malhotra', phone: '98100 12345', ganga: false, params: ['PM', 'SO2', 'NOx', 'Flow', 'Temperature'], scenario: 'red' },
  { id: 'KRK-0392', name: 'KRKA Pulp & Paper', sector: 'Pulp & Paper', loc: 'Yamunanagar, HR', lat: 30.13, lng: 77.28, spcb: 'HSPCB', category: '17-Category', stacks: 1, etp: 1, contact: 'Dr. S. Rao', phone: '98100 23456', ganga: true, params: ['PM', 'COD', 'BOD', 'pH', 'TSS'], scenario: 'orange' },
  { id: 'NCW-0288', name: 'Northern Cement Works', sector: 'Cement', loc: 'Charkhi Dadri, HR', lat: 28.59, lng: 76.27, spcb: 'HSPCB', category: '17-Category', stacks: 1, etp: 0, contact: 'Er. A. Sethi', phone: '98100 34567', ganga: false, params: ['PM', 'SO2', 'NOx'], scenario: 'green' },
  { id: 'GTM-0511', name: 'Ganga Textiles Mills', sector: 'Textiles', loc: 'Panipat, HR', lat: 29.39, lng: 76.97, spcb: 'HSPCB', category: 'GPI in Ganga', stacks: 1, etp: 1, contact: 'Ms. P. Sharma', phone: '98100 45678', ganga: true, params: ['PM', 'COD', 'pH', 'TSS'], scenario: 'yellow' },
  { id: 'YSD-0623', name: 'Yamuna Steel & Alloys', sector: 'Iron & Steel', loc: 'Hisar, HR', lat: 29.15, lng: 75.72, spcb: 'HSPCB', category: '17-Category', stacks: 3, etp: 1, contact: 'Sh. V. Kumar', phone: '98100 56789', ganga: false, params: ['PM', 'SO2', 'NOx', 'CO', 'Flow'], scenario: 'green' },
  { id: 'ATP-0705', name: 'Apex Thermal Power Stn.', sector: 'Power', loc: 'Yamunanagar, HR', lat: 30.1, lng: 77.4, spcb: 'HSPCB', category: '17-Category', stacks: 2, etp: 1, contact: 'Er. M. Iyer', phone: '98100 67890', ganga: false, params: ['PM', 'SO2', 'NOx', 'Flow', 'Temperature'], scenario: 'delay' },
  { id: 'DPF-0819', name: 'Deccan Pharma Formulations', sector: 'Pharma', loc: 'Baddi, HP', lat: 30.96, lng: 76.79, spcb: 'HPPCB', category: '17-Category', stacks: 1, etp: 1, contact: 'Dr. N. Verma', phone: '98100 78901', ganga: false, params: ['PM', 'COD', 'BOD', 'pH'], scenario: 'green' },
  { id: 'MSR-0940', name: 'Meenakshi Solvent Refinery', sector: 'Chemical', loc: 'Rohtak, HR', lat: 28.9, lng: 76.6, spcb: 'HSPCB', category: '17-Category', stacks: 2, etp: 1, contact: 'Sh. D. Mehta', phone: '98100 89012', ganga: false, params: ['PM', 'SO2', 'NOx', 'COD', 'pH'], scenario: 'purple' },
];

function seedParam(key, scenario, siteId) {
  const n = PARAMS[key];
  if (!n) return null;
  const base = n.ph ? 7.4 : n.limit * 0.55;
  const p = {
    key,
    pid: pidFor(siteId, key),
    unit: n.unit,
    limit: n.limit,
    min: n.min,
    value: n.ph ? +base.toFixed(2) : +base.toFixed(1),
    yToday: 0, y30: 0, y30conn: 0,
    connHrs: 0, connFailHrsToday: 0,
    stableHrs: 0, excStreak: 0, redCount30: 0,
    phVal: n.ph ? +base.toFixed(2) : null,
    history: [],
  };
  for (let i = 0; i < 24; i++) {
    const v = n.ph
      ? 7.2 + Math.sin(i / 3) * 0.4
      : n.limit * (0.45 + Math.random() * 0.25);
    p.history.push(+v.toFixed(2));
  }
  if (scenario === 'yellow' && Math.random() < 0.5) { p.yToday = 2; p.value = +(n.limit * 1.15).toFixed(1); }
  if (scenario === 'orange' && Math.random() < 0.5) { p.y30 = 29; p.excStreak = 4; p.value = +(n.limit * 1.3).toFixed(1); }
  if (scenario === 'red' && Math.random() < 0.45) { p.y30 = 56; p.excStreak = 8; p.value = +(n.limit * 1.5).toFixed(1); }
  if (scenario === 'purple' && key === 'pH') { p.phVal = 3.6; p.value = 3.6; p.redCount30 = 2; }
  if (scenario === 'stable' && Math.random() < 0.4) { p.stableHrs = 52; }
  if (scenario === 'delay') { p.y30conn = 6; p.connFailHrsToday = 3; }
  p.signal = gradeParameter(p);
  return p;
}

export function buildSeedSites() {
  return SEED_SITES.map((s) => {
    const params = s.params.map((k) => seedParam(k, s.scenario, s.id)).filter(Boolean);
    const connectivity =
      s.scenario === 'delay' ? 'delay' :
      s.scenario === 'purple' ? 'live' : 'live';
    return {
      ...s,
      params,
      connectivity,
      enabled: true,
      running: true,
      passcode: '1234',
      lastData: connectivity === 'delay' ? '4h 12m ago' : 'just now',
      signal: rollup(params, connectivity === 'delay' ? 'delay' : 'green', true),
    };
  });
}

export function buildSeedAlerts(sites) {
  const alerts = [];
  sites.forEach((s) => {
    s.params.forEach((p) => {
      if (!['green', 'delay'].includes(p.signal)) {
        alerts.push({
          id: 'ALT-' + rid(),
          site: s.name, siteId: s.id, param: p.key,
          level: p.signal,
          reason: p.signal === 'purple' ? 'Critical — 8+ consecutive exceedances' : 'Exceedance flag',
          time: Date.now() - Math.random() * 6 * 3600 * 1000,
        });
      }
    });
  });
  return alerts.sort((a, b) => b.time - a.time);
}

export function buildSeedComplaints() {
  return [
    {
      id: 'CMP-' + rid(), siteId: 'KRK-0392', site: 'KRKA Pulp & Paper',
      cat: 'Calibration',
      msg: 'COD analyzer reading drifting after last service — please recalibrate.',
      status: 'progress', by: 'Dr. S. Rao', time: Date.now() - 2 * 86400000,
    },
    {
      id: 'CMP-' + rid(), siteId: 'ATP-0705', site: 'Apex Thermal Power Stn.',
      cat: 'Connectivity',
      msg: 'Data feed delayed since morning, GPRS modem may be down.',
      status: 'open', by: 'Er. M. Iyer', time: Date.now() - 6 * 3600000,
    },
  ];
}

export function buildSeedServices(sites) {
  const now = Date.now();
  const day = 86400000;
  const map = {};
  sites.forEach((s, idx) => {
    const offset = [300, 25, 400, 5, 70, 48, 190, 14][idx] || 200;
    map[s.id] = {
      DTC: { start: now - 30 * day, expiry: now + offset * day, package: 'dtc-y', history: [], suspended: false },
      'AMC|Gas Analyser':   { start: now - 30 * day, expiry: now + 52 * day, package: 'amc-y', history: [], suspended: false },
      'AMC|Water Analyser': { start: now - 30 * day, expiry: now + 120 * day, package: 'amc-y', history: [], suspended: false },
      'AMC|SPM':            { start: now - 30 * day, expiry: now + (idx === 3 ? 4 : 90) * day, package: 'amc-y', history: [], suspended: false },
      'CMC|Gas Analyser':   { start: now - 30 * day, expiry: now + 200 * day, package: 'cmc-y', history: [], suspended: false },
      'CMC|Water Analyser': { start: now - 30 * day, expiry: now + (idx === 7 ? 6 : 180) * day, package: 'cmc-y', history: [], suspended: false },
      'CMC|SPM':            { start: now - 30 * day, expiry: now + (idx === 0 ? -5 : 240) * day, package: 'cmc-y', history: [], suspended: false },
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