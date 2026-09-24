/* ========== Service contract helpers (DTC / AMC / CMC) ========== */

export const SERVICE_EQUIP = ['Gas Analyser', 'Water Analyser', 'SPM'];

export function serviceLabel(key) {
  const [type, equip] = key.split('|');
  return { type, equip: equip || '—', name: type };
}

export function serviceStatus(c) {
  const expiry = (c && typeof c === 'object') ? c.expiry : c;

  if (c && typeof c === 'object' && c.suspended) {
    return {
      code: 'suspended', label: 'Suspended', hex: '#8a978d',
      days: expiry ? Math.ceil((new Date(expiry) - Date.now()) / 86400000) : null,
    };
  }
  if (!expiry) return { code: 'none', label: 'Not set', hex: '#8a978d', days: null };

  const days = Math.ceil((new Date(expiry) - Date.now()) / 86400000);
  if (days < 0)   return { code: 'expired', label: 'Expired',     hex: '#e23b2e', days };
  if (days <= 7)  return { code: 'week',    label: '≤ 1 week',    hex: '#e23b2e', days };
  if (days <= 15) return { code: 'd15',     label: '≤ 15 days',   hex: '#e8722b', days };
  if (days <= 30) return { code: 'm1',      label: '≤ 1 month',   hex: '#e8722b', days };
  if (days <= 60) return { code: 'm2',      label: '≤ 2 months',  hex: '#f5c518', days };
  return { code: 'ok', label: 'Active', hex: '#1fa971', days };
}

export function siteServiceAlert(site) {
  if (!site.services) return null;
  let worst = null;
  const order = { expired: 6, week: 5, d15: 4, m1: 3, m2: 2, suspended: 1, ok: 1, none: 0 };
  Object.keys(site.services).forEach((k) => {
    const c = site.services[k];
    if (c.suspended) return;
    const st = serviceStatus(c);
    const L = serviceLabel(k);
    if (!worst || order[st.code] > order[worst.code]) {
      worst = { ...st, key: k, type: L.type, equip: L.equip };
    }
  });
  return worst;
}