const PARAMS = require('../utils/paramRegistry');

/* ============================================================
   CPCB grading engine — mirrors the frontend logic
   ============================================================ */

const COMPLIANCE_RANK = {
  green: 1,
  delay: 2,
  yellow: 3,
  orange: 4,
  red: 5,
  purple: 6,
};

const RANK = {
  grey: 0,
  green: 1,
  delay: 2,
  yellow: 3,
  orange: 4,
  red: 5,
  purple: 6,
};

/**
 * Normalizes parameter key/name into standard category.
 */
function getParamCategory(p) {
  if (!p) return '';
  const k = String(p.key || '').trim().toUpperCase();
  const n = String(p.name || '').trim().toUpperCase();

  if (
    k === 'PM' ||
    n === 'PM' ||
    n.startsWith('PM ') ||
    n.includes('PARTICULATE') ||
    (k.includes('PM') && !k.includes('PM2') && !k.includes('PM10') && !k.includes('PM2.5'))
  ) {
    return 'PM';
  }
  if (k === 'COD' || n.includes('COD') || n.includes('CHEMICAL OXYGEN')) {
    return 'COD';
  }
  if (k === 'BOD' || n.includes('BOD') || n.includes('BIOCHEMICAL OXYGEN')) {
    return 'BOD';
  }
  if (k === 'TSS' || n.includes('TSS') || n.includes('TOTAL SUSPENDED')) {
    return 'TSS';
  }
  if (k === 'PH' || n === 'PH' || n.startsWith('PH ') || n.includes('PH')) {
    return 'PH';
  }
  return k;
}

function checkSecondaryCompliance(p) {
  if (p.connHrs >= 96) return 'red';
  if (p.stableHrs >= 144) return 'red';
  if (p.connHrs >= 48) return 'orange';
  if (p.stableHrs >= 72) return 'orange';
  if (p.connFailHrsToday >= 4) return 'yellow';
  if (p.stableHrs >= 48) return 'yellow';
  return 'green';
}

/* ---------- Grade a single parameter ---------- */
function gradeParameter(p) {
  if (!p) return 'green';
  const def = PARAMS[p.key] || {};
  const isEtp = def.type === 'etp';

  // 1. Extreme prolonged connectivity/sensor failure overrides
  if (p.connHrs >= 168) return 'purple';
  if (p.redCount30 > 1) return 'purple';
  if (isEtp && p.y30 >= 192) return 'purple';
  if (p.stableHrs >= 168) return 'purple';

  const rawVal =
    p.value !== null &&
    p.value !== undefined &&
    p.value !== '' &&
    p.value !== 'NA' &&
    p.value !== 'N/A'
      ? Number(p.value)
      : NaN;

  if (!isNaN(rawVal)) {
    const cat = getParamCategory(p);

    if (cat === 'PM') {
      if (rawVal >= 50) return (p.excStreak >= 8 || p.redCount30 > 1) ? 'purple' : 'red';
      if (rawVal >= 45) return 'yellow';
      return checkSecondaryCompliance(p);
    }

    if (cat === 'COD') {
      if (rawVal >= 250) return (p.excStreak >= 8 || p.redCount30 > 1) ? 'purple' : 'red';
      if (rawVal >= 200) return 'yellow';
      return checkSecondaryCompliance(p);
    }

    if (cat === 'BOD') {
      if (rawVal >= 30) return (p.excStreak >= 8 || p.redCount30 > 1) ? 'purple' : 'red';
      if (rawVal >= 25) return 'yellow';
      return checkSecondaryCompliance(p);
    }

    if (cat === 'TSS') {
      if (rawVal >= 100) return (p.excStreak >= 8 || p.redCount30 > 1) ? 'purple' : 'red';
      if (rawVal >= 95) return 'yellow';
      return checkSecondaryCompliance(p);
    }

    if (cat === 'PH') {
      if (rawVal < 4 || rawVal > 12) return 'purple';
      if (rawVal >= 9 || rawVal < 5.5) return (p.excStreak >= 8 || p.redCount30 > 1) ? 'purple' : 'red';
      if ((rawVal >= 8 && rawVal < 9) || (rawVal >= 5.5 && rawVal < 6.5)) return 'yellow';
      return checkSecondaryCompliance(p);
    }

    // Generic parameter check
    const limit = Number(p.limit) || Number(def.limit) || 100;
    if (rawVal >= limit) return (p.excStreak >= 8 || p.redCount30 > 1) ? 'purple' : 'red';
    if (rawVal >= limit * 0.9) return 'yellow';
    return checkSecondaryCompliance(p);
  }

  // Fallback if numerical reading is not available (historical streaks or offline flags)
  if (def.ph && (p.phVal < 4 || p.phVal > 12)) return 'purple';
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

/* ---------- Roll up a site's overall signal ---------- */
function rollup(params, connectivity, enabled) {
  if (enabled === false) return 'grey';
  if (connectivity === 'grey') return 'grey';

  const validParams = (params || []).filter(
    (p) => p && p.signal && p.signal !== 'grey'
  );

  // If every parameter is offline / has no data, site signal is grey (or delay)
  if (validParams.length === 0) {
    return connectivity === 'delay' ? 'delay' : 'grey';
  }

  // Roll up to the worst compliance signal among active reporting parameters
  let worst = connectivity === 'delay' ? 'delay' : 'green';
  for (const p of validParams) {
    if ((COMPLIANCE_RANK[p.signal] || 0) > (COMPLIANCE_RANK[worst] || 0)) {
      worst = p.signal;
    }
  }

  return worst;
}

/* ---------- Human-readable reason for the alert ---------- */
function triggerReason(p) {
  const s = p.signal;
  if (s === 'green') return 'Within limits';
  if (s === 'delay') return 'Data delayed';
  if (s === 'grey') return 'Offline';

  const rawVal =
    p.value !== null &&
    p.value !== undefined &&
    p.value !== '' &&
    p.value !== 'NA' &&
    p.value !== 'N/A'
      ? Number(p.value)
      : NaN;

  const cat = getParamCategory(p);

  if (!isNaN(rawVal)) {
    if (s === 'yellow') {
      if (cat === 'PM') return `Warning (PM: ${rawVal} mg/m³ [45–49])`;
      if (cat === 'COD') return `Warning (COD: ${rawVal} mg/L [200–249])`;
      if (cat === 'BOD') return `Warning (BOD: ${rawVal} mg/L [25–29])`;
      if (cat === 'TSS') return `Warning (TSS: ${rawVal} mg/L [95–99])`;
      if (cat === 'PH') return `Warning (pH: ${rawVal} [8–8.9])`;
      return `Warning (${cat}: ${rawVal} approaching limit)`;
    }
    if (s === 'red' || s === 'orange' || s === 'purple') {
      if (cat === 'PM') return `Exceedance (PM: ${rawVal} mg/m³ ≥ 50)`;
      if (cat === 'COD') return `Exceedance (COD: ${rawVal} mg/L ≥ 250)`;
      if (cat === 'BOD') return `Exceedance (BOD: ${rawVal} mg/L ≥ 30)`;
      if (cat === 'TSS') return `Exceedance (TSS: ${rawVal} mg/L ≥ 100)`;
      if (cat === 'PH') return `Exceedance (pH: ${rawVal} ≥ 9 or < 5.5)`;
      return `Exceedance (${cat}: ${rawVal} over limit)`;
    }
  }

  const b = [];
  if (p.excStreak >= 8) b.push('8 consecutive exceedances');
  else if (p.excStreak >= 4) b.push('4 consecutive exceedances');
  else if (p.yToday >= 2) b.push(`${p.yToday} exceedances today`);

  if (p.y30 >= 54) b.push(`${p.y30} warnings/30d (15%)`);
  else if (p.y30 >= 27) b.push(`${p.y30} warnings/30d (7.5%)`);

  if (p.connHrs >= 48) b.push(`conn-fail ${p.connHrs}h`);
  if (p.stableHrs >= 48) b.push(`frozen sensor ${Math.round(p.stableHrs)}h`);

  const def = PARAMS[p.key];
  if (def && def.ph && (p.phVal < 4 || p.phVal > 12)) b.push('pH out of 4–12');

  return b.join(' · ') || (s === 'yellow' ? 'Warning' : 'Exceedance');
}

/* ---------- Is a reading over its limit? ---------- */
function isOverLimit(p, def) {
  if (!p) return false;
  const rawVal =
    p.value !== null &&
    p.value !== undefined &&
    p.value !== '' &&
    p.value !== 'NA' &&
    p.value !== 'N/A'
      ? Number(p.value)
      : NaN;
  if (isNaN(rawVal)) return false;

  const cat = getParamCategory(p);
  if (cat === 'PM') return rawVal >= 50;
  if (cat === 'COD') return rawVal >= 250;
  if (cat === 'BOD') return rawVal >= 30;
  if (cat === 'TSS') return rawVal >= 100;
  if (cat === 'PH') return rawVal >= 9 || rawVal < 5.5;

  const lim = Number(def?.limit) || Number(p.limit) || 100;
  return rawVal >= lim;
}

/* ---------- Is a reading in warning range? ---------- */
function isWarning(p, def) {
  if (!p) return false;
  const rawVal =
    p.value !== null &&
    p.value !== undefined &&
    p.value !== '' &&
    p.value !== 'NA' &&
    p.value !== 'N/A'
      ? Number(p.value)
      : NaN;
  if (isNaN(rawVal)) return false;

  const cat = getParamCategory(p);
  if (cat === 'PM') return rawVal >= 45 && rawVal < 50;
  if (cat === 'COD') return rawVal >= 200 && rawVal < 250;
  if (cat === 'BOD') return rawVal >= 25 && rawVal < 30;
  if (cat === 'TSS') return rawVal >= 95 && rawVal < 100;
  if (cat === 'PH') return (rawVal >= 8 && rawVal < 9) || (rawVal >= 5.5 && rawVal < 6.5);

  const lim = Number(def?.limit) || Number(p.limit) || 100;
  return rawVal >= lim * 0.9 && rawVal < lim;
}

module.exports = {
  RANK,
  COMPLIANCE_RANK,
  getParamCategory,
  gradeParameter,
  rollup,
  triggerReason,
  isOverLimit,
  isWarning,
};