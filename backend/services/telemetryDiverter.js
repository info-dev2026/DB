/* ============================================================
   services/telemetryDiverter.js

   Generic Telemetry Diverter Engine for Real-Time Parameter Data
   Specifically engineered for ModScan, Modbus Master, PLC, & SCADA
   dataloggers hitting the dashboard via Parameter ID (PID).
   ============================================================ */

require('dotenv').config();
const { Op } = require('sequelize');
const { Site, Param, Reading, Alert, sequelize } = require('../models');
const logger = require('../utils/logger');
const PARAMS = require('../utils/paramRegistry');
const {
  gradeParameter,
  rollup,
  triggerReason,
  isOverLimit,
} = require('./cpcbEngine');
const { broadcast, toSite } = require('./socketService');

/* Helper to strip special characters for robust fuzzy matching */
const cleanAlphanumeric = (str) =>
  String(str || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Normalizes any incoming Modscan or telemetry payload into a standard array of:
 * { siteId, pid, value, ts, raw }
 *
 * Supported input variations:
 * 1. Standard: { readings: [{ pid, value, ts }, ...] }
 * 2. Array directly: [{ pid, value }, ...]
 * 3. Single object: { pid: '855-PH', value: 7.2 } or { parameterId: '855-PH', reading: 7.2 }
 * 4. Modscan Key-Value Map: { siteId: 'ESK-01', "855-PH": 7.2, "855-SOX": 45.1 }
 * 5. Register List: { registers: [{ address: 40001, pid: '855-PH', value: 7.2 }] }
 */
function normalizePayload(body, forcedSiteCode = null) {
  if (!body) return [];

  const siteIdFromPayload =
    body.siteId ||
    body.siteCode ||
    body.site_id ||
    body.site ||
    body.stationId ||
    body.station_id ||
    body.station ||
    body.deviceId ||
    body.device_id ||
    body.id ||
    null;
  const defaultSiteId = forcedSiteCode || siteIdFromPayload;

  // Case 1: Body itself is an array
  if (Array.isArray(body)) {
    return body.map((item) => extractReadingItem(item, defaultSiteId));
  }

  // Case 2: Body has array under `readings`, `registers`, `parameters`, `params`, or `data`
  const possibleArray =
    (Array.isArray(body.readings) && body.readings) ||
    (Array.isArray(body.registers) && body.registers) ||
    (Array.isArray(body.parameters) && body.parameters) ||
    (Array.isArray(body.params) && body.params) ||
    (Array.isArray(body.data) && body.data);

  if (possibleArray) {
    return possibleArray.map((item) => extractReadingItem(item, defaultSiteId));
  }

  // Case 3: Nested object under `data` or `params` or `parameters` (e.g. { siteId: "855", data: { pH: 7.2, COD: 140 } })
  const nestedObj =
    (body.data && typeof body.data === 'object' && !Array.isArray(body.data) && body.data) ||
    (body.params && typeof body.params === 'object' && !Array.isArray(body.params) && body.params) ||
    (body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters) && body.parameters);

  if (nestedObj) {
    const items = [];
    for (const [key, val] of Object.entries(nestedObj)) {
      items.push(extractReadingItem({ pid: key, value: val, siteId: defaultSiteId, ts: body.ts || body.timestamp }, defaultSiteId));
    }
    if (items.length > 0) return items;
  }

  // Case 4: Single reading object at root (e.g. { pid: '855-PH', value: 7.42 })
  const possiblePid =
    body.pid ||
    body.param ||
    body.paramId ||
    body.parameterId ||
    body.parameter ||
    body.tag ||
    body.channel;
  if (possiblePid !== undefined && (body.value !== undefined || body.val !== undefined || body.reading !== undefined)) {
    return [extractReadingItem(body, defaultSiteId)];
  }

  // Case 5: Modscan Key-Value dictionary (e.g. { "855-PH": 7.2, "855-SOX": 45.1 })
  const items = [];
  const reservedKeys = new Set([
    'siteid', 'sitecode', 'site_id', 'site', 'stationid', 'station_id', 'station',
    'deviceid', 'device_id', 'id', 'ts', 'timestamp', 'token', 'apikey', 'api_key',
    'devicekey', 'device_key', 'passcode', 'password', 'data', 'params', 'parameters',
    'readings', 'registers', 'unit', 'signal', 'units', 'status'
  ]);

  for (const [key, val] of Object.entries(body)) {
    if (reservedKeys.has(key.toLowerCase())) continue;

    if (typeof val === 'number' || (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val)))) {
      items.push({
        siteId: defaultSiteId,
        pid: key,
        value: Number(val),
        ts: body.ts || body.timestamp || new Date(),
        raw: { [key]: val },
      });
    } else if (val && typeof val === 'object' && (val.value !== undefined || val.val !== undefined || val.reading !== undefined)) {
      items.push(extractReadingItem({ ...val, pid: val.pid || key }, defaultSiteId));
    }
  }

  return items;
}

/**
 * Extracts a normalized single reading item from any arbitrary record shape
 */
function extractReadingItem(item, fallbackSiteCode = null) {
  if (!item || typeof item !== 'object') {
    return { siteId: fallbackSiteCode, pid: '', value: NaN, ts: new Date() };
  }

  const pid = String(
    item.pid ||
    item.param ||
    item.paramId ||
    item.parameterId ||
    item.parameter ||
    item.key ||
    item.name ||
    item.tag ||
    item.channel ||
    item.address ||
    ''
  ).trim();

  const rawVal =
    item.value !== undefined
      ? item.value
      : item.val !== undefined
      ? item.val
      : item.reading !== undefined
      ? item.reading
      : item.data;

  const isNA =
    rawVal === null ||
    rawVal === undefined ||
    String(rawVal).trim().toUpperCase() === 'NA' ||
    String(rawVal).trim().toUpperCase() === 'N/A' ||
    String(rawVal).trim().toUpperCase() === 'NULL' ||
    String(rawVal).trim().toUpperCase() === 'NONE';

  const value = isNA ? null : Number(rawVal);
  const ts = item.ts ? new Date(item.ts) : item.timestamp ? new Date(item.timestamp) : new Date();

  return {
    siteId: item.siteId || item.siteCode || item.site_id || item.site || fallbackSiteCode,
    pid,
    value,
    isNA,
    ts: isNaN(ts.getTime()) ? new Date() : ts,
    raw: item,
  };
}

/**
 * Generic multi-tier parameter matching function.
 * Matches any incoming Parameter ID (PID), parameter name, or Modscan channel
 * to the configured Param on the site in the database.
 */
function matchParameterByPid(siteParams, paramReq, siteCode = '') {
  if (!paramReq || !Array.isArray(siteParams) || !siteParams.length) return null;

  const reqUp = String(paramReq).trim().toUpperCase();
  const reqClean = cleanAlphanumeric(reqUp);
  const siteClean = cleanAlphanumeric(siteCode);

  // Helper to strip site prefix from a string
  const stripSite = (str) => {
    if (!siteClean || !str) return str;
    const cleanStr = cleanAlphanumeric(str);
    if (cleanStr.startsWith(siteClean) && cleanStr.length > siteClean.length) {
      return cleanStr.slice(siteClean.length);
    }
    return cleanStr;
  };

  const strippedReq = stripSite(reqClean);

  // Tier 1: Exact or Normalized Parameter ID (PID) Match
  let match = siteParams.find((p) => {
    if (!p.pid) return false;
    const pidUp = String(p.pid).trim().toUpperCase();
    const pidClean = cleanAlphanumeric(pidUp);
    return pidUp === reqUp || pidClean === reqClean;
  });
  if (match) return match;

  // Tier 2: Prefix / Suffix and Stripped Site Code PID Match
  // E.g. "855-PH" matches "855-PH-INLET", "GTB_123-COD" matches "GTB_123-COD-1"
  match = siteParams.find((p) => {
    if (!p.pid) return false;
    const pidUp = String(p.pid).trim().toUpperCase();
    const pidClean = cleanAlphanumeric(pidUp);
    const strippedPid = stripSite(pidClean);

    // Direct startsWith / endsWith
    if (pidUp.startsWith(reqUp + '-') || pidUp.startsWith(reqUp + '_') || pidUp === reqUp) return true;
    if (pidUp.endsWith('-' + reqUp) || pidUp.endsWith('_' + reqUp)) return true;
    if (reqClean.length >= 3 && pidClean.startsWith(reqClean)) return true;
    if (reqClean.length >= 3 && pidClean.endsWith(reqClean)) return true;

    // Stripped site codes matching
    if (strippedReq && strippedPid) {
      if (strippedPid === strippedReq) return true;
      if (strippedPid.startsWith(strippedReq) || strippedReq.startsWith(strippedPid)) return true;
      if (strippedPid.endsWith(strippedReq) || strippedReq.endsWith(strippedPid)) return true;
    }

    if (reqUp === `${siteClean}-${pidUp}` || reqClean === `${siteClean}${pidClean}`) return true;
    if (pidUp === `${siteClean}-${reqUp}` || pidClean === `${siteClean}${reqClean}`) return true;
    return false;
  });
  if (match) return match;

  // Tier 3: Parameter Key Match (e.g. "pH", "COD", "BOD", "TSS", "SOX", "PM")
  // Check if req matches the parameter key or translated key
  const matchingKeyParams = siteParams.filter((p) => {
    if (!p.key) return false;
    const keyUp = String(p.key).trim().toUpperCase();
    const keyClean = cleanAlphanumeric(keyUp);
    const strippedPid = stripSite(cleanAlphanumeric(p.pid));

    const isKeyDirect =
      keyUp === reqUp ||
      keyClean === reqClean ||
      (strippedReq && keyClean === strippedReq) ||
      (strippedPid && strippedReq && strippedPid.includes(strippedReq));

    if (isKeyDirect) return true;
    if ((keyUp === 'SOX' || keyClean === 'SOX') && (reqUp === 'SO2' || reqClean === 'SO2' || strippedReq === 'SO2')) return true;
    if ((keyUp === 'SO2' || keyClean === 'SO2') && (reqUp === 'SOX' || reqClean === 'SOX' || strippedReq === 'SOX')) return true;
    return false;
  });

  if (matchingKeyParams.length === 1) {
    return matchingKeyParams[0];
  }
  if (matchingKeyParams.length > 1) {
    // If multiple parameters share this key (e.g. Stack 1 PM vs Stack 2 PM),
    // pick the one that best matches the suffix/index
    const subMatch = matchingKeyParams.find((p) => {
      const pidClean = cleanAlphanumeric(p.pid);
      return pidClean.endsWith(reqClean) || reqClean.endsWith(pidClean);
    });
    if (subMatch) return subMatch;
  }

  // Tier 4: Custom Name Match (e.g. "Inlet pH", "Stack 1 PM")
  match = siteParams.find((p) => {
    if (!p.name) return false;
    const nameUp = String(p.name).trim().toUpperCase();
    const nameClean = cleanAlphanumeric(nameUp);
    return (
      nameUp === reqUp ||
      (nameClean && nameClean === reqClean) ||
      (nameClean && strippedReq && nameClean.includes(strippedReq)) ||
      (nameClean && reqClean && reqClean.length >= 4 && nameClean.includes(reqClean))
    );
  });
  if (match) return match;

  // Tier 5: Fallback partial match if uniquely 1 parameter matches
  const partialMatches = siteParams.filter((p) => {
    const pidClean = cleanAlphanumeric(p.pid);
    const keyClean = cleanAlphanumeric(p.key);
    return (
      (strippedReq.length >= 2 && (pidClean.includes(strippedReq) || keyClean.includes(strippedReq))) ||
      (reqClean.length >= 3 && pidClean.includes(reqClean))
    );
  });
  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  return null;
}

/**
 * Universal Telemetry Diverter Function.
 * Accepts any Modscan / datalogger input, diverts each parameter reading
 * to its corresponding site & parameter, updates rolling history, evaluates limits,
 * saves to DB, and broadcasts live WebSocket events to the dashboard.
 *
 * @param {object|array} payload - Incoming readings payload
 * @param {string} [forcedSiteCode] - Optional siteCode bound by per-site API/logger key
 * @returns {Promise<object>} Detailed diversion result report
 */
async function divertTelemetry({ payload, forcedSiteCode = null }) {
  const normalizedReadings = normalizePayload(payload, forcedSiteCode);

  if (!normalizedReadings.length) {
    return {
      ok: false,
      error: 'No valid readings found in payload',
      divertedCount: 0,
      diverted: [],
      skipped: [],
    };
  }

  const t = await sequelize.transaction();

  try {
    // 1. Gather all target site codes
    const targetSiteCodes = forcedSiteCode
      ? [forcedSiteCode]
      : [...new Set(normalizedReadings.map((r) => r.siteId).filter(Boolean))];

    // If siteId was not provided per reading and not forced, look up all sites
    let siteQuery = {};
    if (targetSiteCodes.length) {
      const upperCodes = targetSiteCodes.map((c) => String(c).trim().toUpperCase());
      const lowerCodes = targetSiteCodes.map((c) => String(c).trim().toLowerCase());
      const rawCodes = targetSiteCodes.map((c) => String(c).trim());
      const allCodes = [...new Set([...upperCodes, ...lowerCodes, ...rawCodes])];
      siteQuery = {
        siteCode: { [Op.in]: allCodes },
      };
    }

    const sites = await Site.findAll({
      where: siteQuery,
      include: [{ model: Param, as: 'params' }],
      transaction: t,
    });

    const siteMap = new Map();
    for (const s of sites) {
      siteMap.set(s.siteCode, s);
      siteMap.set(s.siteCode.toUpperCase(), s);
      siteMap.set(cleanAlphanumeric(s.siteCode), s);
      if (s.id) siteMap.set(String(s.id), s);
    }

    const touchedSiteCodes = new Set();
    const divertedResults = [];
    const skippedResults = [];

    // 2. Divert each parameter reading generically
    for (const r of normalizedReadings) {
      // Determine target site
      let site = null;
      const lookupCode = forcedSiteCode || r.siteId;
      if (lookupCode) {
        site =
          siteMap.get(lookupCode) ||
          siteMap.get(String(lookupCode).toUpperCase()) ||
          siteMap.get(cleanAlphanumeric(lookupCode));
      } else if (sites.length === 1) {
        site = sites[0];
      }

      if (!site) {
        skippedResults.push({
          pid: r.pid,
          value: r.value,
          reason: `Target site "${r.siteId || forcedSiteCode || 'unknown'}" not found`,
        });
        continue;
      }

      // Generic parameter matching by PID
      const param = matchParameterByPid(site.params, r.pid, site.siteCode);

      if (!param) {
        skippedResults.push({
          pid: r.pid,
          value: r.value,
          siteCode: site.siteCode,
          reason: `Unmatched Parameter ID "${r.pid}" for site "${site.siteCode}"`,
        });
        logger.warn(
          `⚠️  [Telemetry Diverter] Unmatched PID "${r.pid}" for site "${site.siteCode}". Configured PIDs: ${site.params
            .map((p) => `[${p.pid}] ${p.key}`)
            .join(', ')}`
        );
        continue;
      }

      const def = PARAMS[param.key] || {};

      // If reading is NA / null (data isn't receiving on instrument)
      if (r.isNA || r.value === null) {
        const updatedParamFields = {
          value: null,
          signal: 'grey',
          connHrs: Math.max(4, (param.connHrs || 0) + 1),
        };
        await param.update(updatedParamFields, { transaction: t });

        const telemetryReadingEvent = {
          siteId: site.siteCode,
          pid: param.pid,
          key: param.key,
          name: param.name || param.key,
          value: 'NA',
          unit: param.unit || def.unit || '',
          signal: 'grey',
          overLimit: false,
          limit: param.limit,
          ts: r.ts.toISOString(),
        };

        broadcast('telemetry:reading', telemetryReadingEvent);
        toSite(site.siteCode, 'telemetry:reading', telemetryReadingEvent);

        divertedResults.push({
          pid: param.pid,
          requestedPid: r.pid,
          key: param.key,
          name: param.name || param.key,
          siteCode: site.siteCode,
          value: 'NA',
          signal: 'grey',
          status: 'diverted_na',
        });

        touchedSiteCodes.add(site.siteCode);
        continue;
      }

      if (isNaN(r.value)) {
        skippedResults.push({
          pid: r.pid,
          value: r.value,
          siteCode: site.siteCode,
          reason: 'Invalid numerical value (NaN)',
        });
        continue;
      }

      const prevSignal = param.signal;
      const newValue = Number(r.value);

      // Rolling 24-point history buffer
      const history = Array.isArray(param.history) ? [...param.history] : [];
      history.push(newValue);
      if (history.length > 24) history.shift();

      // CPCB Limit & Exceedance evaluation
      const over = isOverLimit({ ...param.toJSON(), value: newValue }, def);
      const nextExcStreak = over
        ? (param.excStreak || 0) + 1
        : Math.max(0, (param.excStreak || 0) - 1);

      const updatedParamFields = {
        value: newValue,
        phVal: def.ph ? newValue : param.phVal,
        history,
        excStreak: nextExcStreak,
        yToday: over ? (param.yToday || 0) + 1 : param.yToday || 0,
        y30: over ? (param.y30 || 0) + 1 : param.y30 || 0,
        connHrs: 0,
        connFailHrsToday: 0,
      };

      const nextSignal = gradeParameter({ ...param.toJSON(), ...updatedParamFields });
      updatedParamFields.signal = nextSignal;

      // Update database parameter record
      await param.update(updatedParamFields, { transaction: t });

      // Save historical reading point
      await Reading.create(
        {
          siteCode: site.siteCode,
          pid: param.pid,
          param: param.key,
          value: newValue,
          ts: r.ts,
        },
        { transaction: t }
      );

      // Trigger instant alert if parameter signal transitioned into warning/critical
      if (
        nextSignal !== prevSignal &&
        ['yellow', 'orange', 'red', 'purple'].includes(nextSignal)
      ) {
        const alert = await Alert.create(
          {
            siteCode: site.siteCode,
            siteName: site.name,
            param: param.key,
            level: nextSignal,
            reason: triggerReason({ ...param.toJSON(), ...updatedParamFields }),
            ts: new Date(),
          },
          { transaction: t }
        );

        const alertJSON = {
          _id: String(alert.id),
          siteId: site.siteCode,
          site: site.name,
          param: param.key,
          pid: param.pid,
          level: nextSignal,
          reason: alert.reason,
          acknowledged: false,
          ts: alert.ts,
        };

        broadcast('alert:new', alertJSON);
        toSite(site.siteCode, 'alert:new', alertJSON);

        logger.warn(
          `⚠️  [ALERT TRIGGERED] [${nextSignal.toUpperCase()}] ${site.siteCode} · PID: ${param.pid} (${param.key}) = ${newValue}`
        );
      }

      // Live parameter telemetry broadcast (for immediate micro-updates)
      const telemetryReadingEvent = {
        siteId: site.siteCode,
        pid: param.pid,
        key: param.key,
        name: param.name || param.key,
        value: newValue,
        unit: param.unit || def.unit || '',
        signal: nextSignal,
        overLimit: over,
        limit: param.limit,
        ts: r.ts.toISOString(),
      };

      broadcast('telemetry:reading', telemetryReadingEvent);
      toSite(site.siteCode, 'telemetry:reading', telemetryReadingEvent);

      divertedResults.push({
        pid: param.pid,
        requestedPid: r.pid,
        key: param.key,
        name: param.name || param.key,
        siteCode: site.siteCode,
        value: newValue,
        signal: nextSignal,
        status: 'diverted',
      });

      touchedSiteCodes.add(site.siteCode);
    }

    // 3. Update touched sites with fresh status, rollup signal, and broadcast `site:update`
    for (const code of touchedSiteCodes) {
      const site = siteMap.get(code);
      const freshParams = await Param.findAll({
        where: { siteCode: code },
        transaction: t,
      });

      const paramJSON = await Promise.all(
        freshParams.map(async (p) => {
          const plain = p.toJSON();
          const hasValue = plain.value != null && !isNaN(Number(plain.value));
          let paramSig = 'grey';
          if (hasValue) {
            if (plain.signal && plain.signal !== 'grey') {
              paramSig = plain.signal;
            } else {
              paramSig = gradeParameter(plain);
              await p.update({ signal: paramSig }, { transaction: t });
            }
          }
          return {
            ...plain,
            value: hasValue ? Number(plain.value) : null,
            hasReceivedData: hasValue,
            signal: paramSig,
            name: plain.name || plain.key,
            updatedAt: hasValue ? (plain.updatedAt || new Date().toISOString()) : null,
            lastData: hasValue ? (plain.lastData || 'just now') : 'No data',
          };
        })
      );

      const newSignal = rollup(paramJSON, 'live', site.enabled);

      await site.update(
        {
          lastSeenAt: new Date(),
          connectivity: 'live',
          running: true,
          lastData: 'just now',
          signal: newSignal,
        },
        { transaction: t }
      );

      const updatePayload = {
        siteId: site.siteCode,
        signal: newSignal,
        connectivity: 'live',
        running: true,
        lastData: 'just now',
        lastSeenAt: new Date().toISOString(),
        params: paramJSON,
      };

      broadcast('site:update', updatePayload);
      toSite(site.siteCode, 'site:update', updatePayload);
    }

    await t.commit();

    return {
      ok: true,
      applied: divertedResults.length,
      divertedCount: divertedResults.length,
      skippedCount: skippedResults.length,
      diverted: divertedResults,
      skipped: skippedResults,
      touchedSites: Array.from(touchedSiteCodes),
    };
  } catch (error) {
    await t.rollback();
    logger.error('❌ Telemetry diverter transaction failed:', error);
    throw error;
  }
}

module.exports = {
  divertTelemetry,
  normalizePayload,
  matchParameterByPid,
};
