const PARAMS = require('../utils/paramRegistry');

/* ============================================================
   CPCB grading engine — mirrors the frontend logic
   ============================================================ */

const RANK = { green: 0, delay: 1, yellow: 2, orange: 3, red: 4, purple: 5, grey: 6 };

/* ---------- Grade a single parameter ---------- */
function gradeParameter(p) {
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

/* ---------- Roll up a site's overall signal ---------- */
function rollup(params, connectivity, enabled) {
  if (enabled === false) return 'grey';
  if (connectivity === 'grey') return 'grey';
  let worst = connectivity === 'delay' ? 'delay' : 'green';
  (params || []).forEach((p) => {
    if ((RANK[p.signal] || 0) > (RANK[worst] || 0)) worst = p.signal;
  });
  return worst;
}

/* ---------- Human-readable reason for the alert ---------- */
function triggerReason(p) {
  const s = p.signal;
  if (s === 'green') return 'Within limits';
  if (s === 'delay') return 'Data delayed';
  if (s === 'grey') return 'Offline';

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

  return b.join(' · ') || 'Exceedance';
}

/* ---------- Is a reading over its limit? ---------- */
function isOverLimit(p, def) {
  if (def.ph) return p.value > def.limit || p.value < (def.min || 6.5);
  return p.value > (def.limit || p.limit || 100);
}

module.exports = { RANK, gradeParameter, rollup, triggerReason, isOverLimit };