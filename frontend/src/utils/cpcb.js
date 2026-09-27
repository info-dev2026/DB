/* ========== CPCB grading logic (mirrors the backend) ========== */

export const PARAMS = {
  PM:          { pid: 'P-PM',   unit: 'mg/Nm³', limit: 50,  dev: 60,  type: 'stack', label: 'Particulate Matter' },
  SO2:         { pid: 'P-SO2',  unit: 'mg/Nm³', limit: 200, dev: 25,  type: 'stack', label: 'Sulphur Dioxide' },
  NOx:         { pid: 'P-NOX',  unit: 'mg/Nm³', limit: 300, dev: 25,  type: 'stack', label: 'Oxides of Nitrogen' },
  CO:          { pid: 'P-CO',   unit: 'mg/Nm³', limit: 100, dev: 25,  type: 'stack', label: 'Carbon Monoxide' },
  Flow:        { pid: 'P-FLOW', unit: 'm³/s',   limit: 5,   dev: 50,  type: 'stack', label: 'Stack Flow' },
  Temperature: { pid: 'P-TEMP', unit: '°C',     limit: 180, dev: 40,  type: 'stack', label: 'Flue Temperature' },
  Pressure:    { pid: 'P-PRES', unit: 'mmH₂O',  limit: 120, dev: 40,  type: 'stack', label: 'Static Pressure' },
  pH:          { pid: 'P-PH',   unit: '',       limit: 8.5, min: 6.5, dev: 0,   type: 'etp', ph: true, label: 'pH' },
  BOD:         { pid: 'P-BOD',  unit: 'mg/L',   limit: 30,  dev: 100, type: 'etp', label: 'Biochemical Oxygen Demand' },
  COD:         { pid: 'P-COD',  unit: 'mg/L',   limit: 250, dev: 100, type: 'etp', label: 'Chemical Oxygen Demand' },
  TSS:         { pid: 'P-TSS',  unit: 'mg/L',   limit: 100, dev: 100, type: 'etp', label: 'Total Suspended Solids' },
  TOC:         { pid: 'P-TOC',  unit: 'mg/L',   limit: 100, dev: 100, type: 'etp', label: 'Total Organic Carbon' },
};

export const RANK = { green: 0, delay: 1, yellow: 2, orange: 3, red: 4, purple: 5, grey: 6 };

export const SIG_LABEL = {
  green: 'Compliant',
  delay: 'Delayed',
  yellow: 'Warning',
  orange: 'Orange',
  red: 'Exceedance',
  purple: 'Critical',
  grey: 'Offline',
};

export const HEX = {
  green: '#1fa971',
  yellow: '#f5c518',
  orange: '#e8722b',
  red: '#e23b2e',
  purple: '#7b3fe4',
  grey: '#8a978d',
  delay: '#b98a1e',
};

export const ACTIONS = {
  yellow: 'Corrective measures required immediately. Record incidence for SPCB/CPCB.',
  orange: 'Corrective action + notify SPCB/CPCB of incidence and measures taken.',
  red: 'Immediately impound discharge/emission. Submit 24-hr report; inspection priority.',
  purple: 'Impound discharge. Root-Cause Analysis + Action-Taken Report to SPCB/CPCB.',
  grey: 'No data > 48 h. Restore connectivity; notify CPCB/SPCB.',
  delay: 'No data in last 4 h. Check internet/power/sensor.',
};

export function gradeParameter(p) {
  const def = PARAMS[p.key] || {};
  const isEtp = def.type === 'etp';
  if (p.connHrs >= 168) return 'purple';
  if (p.redCount30 > 1) return 'purple';
  if (isEtp && p.y30 >= 192) return 'purple';
  if (def.ph && (p.phVal < 4 || p.phVal > 12)) return 'purple';
  if (p.stableHrs >= 168) return 'purple';
  if (p.excStreak >= 8) return 'red';
  if (p.y30 >= 54) return 'red';
  if (p.connHrs >= 96) return 'red';
  if (p.y30conn >= 18) return 'red';
  if (p.stableHrs >= 144) return 'red';
  if (p.excStreak >= 4) return 'orange';
  if (p.y30 >= 27) return 'orange';
  if (p.connHrs >= 48) return 'orange';
  if (p.y30conn >= 12) return 'orange';
  if (p.stableHrs >= 72) return 'orange';
  if (p.yToday >= 2) return 'yellow';
  if (p.connFailHrsToday >= 4) return 'yellow';
  if (p.stableHrs >= 48) return 'yellow';
  return 'green';
}

export function rollup(params, connectivity, enabled) {
  if (enabled === false) return 'grey';
  if (connectivity === 'grey') return 'grey';
  let worst = connectivity === 'delay' ? 'delay' : 'green';
  (params || []).forEach((p) => {
    if (RANK[p.signal] > RANK[worst]) worst = p.signal;
  });
  return worst;
}

export function triggerReason(p) {
  const s = p.signal;
  if (s === 'green') return 'Within limits';
  if (s === 'delay') return 'Data delayed';
  if (s === 'grey') return 'Offline';
  const b = [];
  if (p.excStreak >= 8) b.push('8 consecutive exceedances');
  else if (p.excStreak >= 4) b.push('4 consecutive exceedances');
  else if (p.yToday >= 2) b.push(p.yToday + ' exceedances today');
  if (p.y30 >= 54) b.push(p.y30 + ' warnings/30d (15%)');
  else if (p.y30 >= 27) b.push(p.y30 + ' warnings/30d (7.5%)');
  if (p.connHrs >= 48) b.push('conn-fail ' + p.connHrs + 'h');
  if (p.stableHrs >= 48) b.push('frozen sensor ' + Math.round(p.stableHrs) + 'h');
  const def = PARAMS[p.key];
  if (def && def.ph && (p.phVal < 4 || p.phVal > 12)) b.push('pH out of 4–12');
  return b.join(' · ') || 'Exceedance';
}

export function pidFor(siteId, key) {
  const suffix = PARAMS[key] && PARAMS[key].pid
    ? PARAMS[key].pid.replace(/^P-/, '')
    : key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (siteId ? siteId.toUpperCase() + '-' : '') + suffix;
}