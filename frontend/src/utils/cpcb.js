/* ========== CPCB grading logic (mirrors the backend) ========== */

export const PARAMS = {
  PM:          { pid: 'P-PM',   unit: 'mg/m3',  limit: 50,  dev: 60,  type: 'stack', label: 'Particulate Matter' },
  SOX:         { pid: 'P-SOX',  unit: 'mg/Nm³', limit: 200, dev: 25,  type: 'stack', label: 'Sulphur Dioxide' },
  NOx:         { pid: 'P-NOX',  unit: 'mg/Nm³', limit: 300, dev: 25,  type: 'stack', label: 'Oxides of Nitrogen' },
  CO:          { pid: 'P-CO',   unit: 'mg/Nm³', limit: 100, dev: 25,  type: 'stack', label: 'Carbon Monoxide' },
  Flow:        { pid: 'P-FLOW', unit: 'm³/s',   limit: 5,   dev: 50,  type: 'stack', label: 'Stack Flow' },
  Temperature: { pid: 'P-TEMP', unit: '°C',     limit: 180, dev: 40,  type: 'stack', label: 'Temperature' },
  Pressure:    { pid: 'P-PRES', unit: 'mmH₂O',  limit: 120, dev: 40,  type: 'stack', label: 'Static Pressure' },
  'PM2.5':     { pid: 'P-PM25', unit: 'µg/m³', limit: 60,  dev: 50,  type: 'ambient', label: 'PM 2.5' },
  PM10:        { pid: 'P-PM10', unit: 'µg/m³', limit: 100, dev: 50,  type: 'ambient', label: 'PM 10' },
  Humidity:    { pid: 'P-HUM',  unit: '%',     limit: 100, dev: 30,  type: 'ambient', label: 'Relative Humidity' },
  pH:          { pid: 'P-PH',   unit: '',       limit: 8.5, min: 6.5, dev: 0,   type: 'etp', ph: true, label: 'pH' },
  BOD:         { pid: 'P-BOD',  unit: 'mg/L',   limit: 30,  dev: 100, type: 'etp', label: 'Biochemical Oxygen Demand' },
  COD:         { pid: 'P-COD',  unit: 'mg/L',   limit: 250, dev: 100, type: 'etp', label: 'Chemical Oxygen Demand' },
  TSS:         { pid: 'P-TSS',  unit: 'mg/L',   limit: 100, dev: 100, type: 'etp', label: 'Total Suspended Solids' },
  TOC:         { pid: 'P-TOC',  unit: 'mg/L',   limit: 100, dev: 100, type: 'etp', label: 'Total Organic Carbon' },
};

/* Backward-compatibility alias so legacy lookups for SO2 resolve to SOX */
Object.defineProperty(PARAMS, 'SO2', {
  value: PARAMS.SOX,
  enumerable: false,
  writable: true,
  configurable: true,
});

export const COMPLIANCE_RANK = {
  green: 1,
  delay: 2,
  yellow: 3,
  orange: 4,
  red: 5,
  purple: 6,
};

export const RANK = {
  grey: 0,
  green: 1,
  delay: 2,
  yellow: 3,
  orange: 4,
  red: 5,
  purple: 6,
};

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

  const validParams = (params || []).filter(
    (p) => p && p.signal && p.signal !== 'grey'
  );

  // If every parameter is offline / has no data, site signal is grey (or delay if connectivity is delayed)
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
  const normKey = key === 'SO2' ? 'SOX' : key;
  const suffix = PARAMS[normKey] && PARAMS[normKey].pid
    ? PARAMS[normKey].pid.replace(/^P-/, '')
    : normKey.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (siteId ? siteId.toUpperCase() + '-' : '') + suffix;
}

export function displayParamKey(k) {
  return k === 'SO2' ? 'SOX' : k;
}

export function displayParamName(name, key) {
  if (!name || name === key) return displayParamKey(key);
  return String(name).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX');
}

/**
 * Determines whether real-time data is actively being received for a parameter.
 * Returns false (data NOT receiving) when:
 * 1. Parameter value is null, undefined, empty string, 'NA', 'N/A', or NaN
 * 2. Site is offline (connectivity === 'grey' or signal === 'grey' or running === false)
 * 3. Parameter is offline (signal === 'grey' or connHrs >= 4)
 * 4. No telemetry data has been received yet (no history, no timestamp, or lastData === 'No data')
 */
export function isDataReceiving(param, site) {
  if (!param) return false;

  // 1. Explicit NA / null / undefined / NaN
  if (
    param.value === null ||
    param.value === undefined ||
    param.value === '' ||
    param.value === 'NA' ||
    param.value === 'N/A' ||
    param.value === 'null' ||
    param.value === 'undefined'
  ) {
    return false;
  }
  const numVal = Number(param.value);
  if (isNaN(numVal)) {
    return false;
  }

  // 2. If parameter explicitly flagged as no data received and value is 0
  if (param.hasReceivedData === false && numVal === 0) {
    return false;
  }

  // 3. Site disabled check
  if (site && site.enabled === false) {
    return false;
  }

  return true;
}

export function formatParamValue(param, site) {
  if (!isDataReceiving(param, site)) {
    return 'NA';
  }
  const val = Number(param.value);
  if (isNaN(val)) return param.value;
  return Number.isInteger(val) ? val : Math.round(val * 100) / 100;
}

/* ---------- Custom parameters registry persistence ---------- */
export function loadCustomParams() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('sz_custom_params');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((p) => {
          if (p && p.key) {
            const k = String(p.key).trim().toUpperCase();
            PARAMS[k] = {
              pid: p.pid || `P-${k}`,
              unit: p.unit || '',
              limit: Number(p.limit) || 100,
              dev: Number(p.dev) || 25,
              type: p.type || 'stack',
              label: p.label || p.name || k,
              ph: !!p.ph,
              min: p.ph ? (Number(p.min) ?? 6.5) : undefined,
              isCustom: true,
            };
          }
        });
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to load custom params:', err);
  }
  return [];
}

export function saveCustomParam(param) {
  if (typeof window === 'undefined' || !param || !param.key) return;
  const key = String(param.key).trim().toUpperCase().replace(/[^A-Z0-9_.]/g, '');
  const normalized = {
    key,
    pid: param.pid ? String(param.pid).trim().toUpperCase() : `P-${key}`,
    unit: param.unit || '',
    limit: Number(param.limit) || 100,
    dev: Number(param.dev) || 25,
    type: param.type || 'stack',
    label: param.label || param.name || key,
    ph: !!param.ph,
    min: param.ph ? (Number(param.min) ?? 6.5) : undefined,
    isCustom: true,
  };
  PARAMS[key] = normalized;

  try {
    const raw = localStorage.getItem('sz_custom_params');
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    const existingIdx = list.findIndex((x) => x.key?.toLowerCase() === key.toLowerCase());
    if (existingIdx >= 0) {
      list[existingIdx] = normalized;
    } else {
      list.push(normalized);
    }
    localStorage.setItem('sz_custom_params', JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('sz-params-updated', { detail: normalized }));
  } catch (err) {
    console.warn('Failed to save custom param:', err);
  }
  return normalized;
}

export function deleteCustomParam(key) {
  if (typeof window === 'undefined' || !key) return;
  const normKey = String(key).trim().toUpperCase();
  delete PARAMS[normKey];
  try {
    const raw = localStorage.getItem('sz_custom_params');
    let list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      list = list.filter((x) => x.key?.toUpperCase() !== normKey);
      localStorage.setItem('sz_custom_params', JSON.stringify(list));
    }
    window.dispatchEvent(new CustomEvent('sz-params-updated', { detail: { key: normKey, deleted: true } }));
  } catch (err) {
    console.warn('Failed to delete custom param:', err);
  }
}

export function getCustomParamName(siteId, pid) {
  if (typeof window === 'undefined' || !pid) return null;
  try {
    const raw = localStorage.getItem('sz_custom_param_names');
    if (raw) {
      const map = JSON.parse(raw);
      if (typeof map === 'object' && map !== null) {
        if (siteId && map[`${siteId}:${pid}`]) return map[`${siteId}:${pid}`];
        if (map[pid]) return map[pid];
      }
    }
  } catch {}
  return null;
}

export function setCustomParamName(siteId, pid, name) {
  if (typeof window === 'undefined' || !pid) return;
  try {
    const raw = localStorage.getItem('sz_custom_param_names');
    const map = raw ? JSON.parse(raw) : {};
    const siteKey = siteId ? `${siteId}:${pid}` : null;
    if (name && String(name).trim()) {
      const val = String(name).trim();
      if (siteKey) map[siteKey] = val;
      map[pid] = val;
    } else {
      if (siteKey) delete map[siteKey];
      delete map[pid];
    }
    localStorage.setItem('sz_custom_param_names', JSON.stringify(map));
  } catch {}
}

// Auto-load on script load
if (typeof window !== 'undefined') {
  loadCustomParams();
}