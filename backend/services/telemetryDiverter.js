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

  // Case 1: Body itself is an array
  if (Array.isArray(body)) {
    return body.map((item) => extractReadingItem(item, forcedSiteCode));
  }

  // Case 2: Body has `readings` array
  if (Array.isArray(body.readings)) {
    return body.readings.map((item) =>
      extractReadingItem(item, forcedSiteCode || body.siteId || body.siteCode)
    );
  }

  // Case 3: Body has `registers` array (common in Modbus/Modscan bridges)
  if (Array.isArray(body.registers)) {
    return body.registers.map((item) =>
      extractReadingItem(item, forcedSiteCode || body.siteId || body.siteCode)
    );
  }

  // Case 4: Single reading object at root (e.g. { pid: '855-PH', value: 7.42 })
  const possiblePid =
    body.pid ||
    body.param ||
    body.paramId ||
    body.parameterId ||
    body.tag ||
    body.channel;
  if (possiblePid !== undefined && (body.value !== undefined || body.val !== undefined || body.reading !== undefined)) {
    return [extractReadingItem(body, forcedSiteCode || body.siteId || body.siteCode)];
  }

  // Case 5: Modscan Key-Value dictionary (e.g. { "855-PH": 7.2, "855-SOX": 45.1 })
  const defaultSiteId = forcedSiteCode || body.siteId || body.siteCode || null;
  const items = [];
  const reservedKeys = new Set(['siteId', 'siteCode', 'ts', 'timestamp', 'token', 'apiKey']);

  for (const [key, val] of Object.entries(body)) {
    if (reservedKeys.has(key)) continue;

    if (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)))) {
      items.push({
        siteId: defaultSiteId,
        pid: key,
        value: Number(val),
        ts: body.ts || body.timestamp || new Date(),
        raw: { [key]: val },
      });
    } else if (val && typeof val === 'object' && (val.value !== undefined || val.val !== undefined)) {
      items.push({
        siteId: defaultSiteId,
        pid: val.pid || key,
        value: Number(val.value !== undefined ? val.value : val.val),
        ts: val.ts || body.ts || new Date(),
        raw: val,
      });
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

  const value = Number(rawVal);
  const ts = item.ts ? new Date(item.ts) : item.timestamp ? new Date(item.timestamp) : new Date();

  return {
    siteId: item.siteId || item.siteCode || fallbackSiteCode,
    pid,
    value,
    ts: isNaN(ts.getTime()) ? new Date() : ts,
    raw: item,
  };
}

/**
 * Generic 4-tier parameter matching function.
 * Matches any incoming Parameter ID (PID) or Modscan channel to the configured Param in the database.
 */
function matchParameterByPid(siteParams, paramReq, siteCode = '') {
  if (!paramReq || !Array.isArray(siteParams) || !siteParams.length) return null;

  const reqUp = String(paramReq).trim().toUpperCase();
  const reqClean = cleanAlphanumeric(reqUp);
  const siteClean = cleanAlphanumeric(siteCode);

  // Tier 1: Exact or Normalized Parameter ID (PID) Match
  let match = siteParams.find((p) => {
    if (!p.pid) return false;
    const pidUp = String(p.pid).trim().toUpperCase();
    const pidClean = cleanAlphanumeric(pidUp);

    // Exact match: "855-PH" === "855-PH"
    if (pidUp === reqUp || pidClean === reqClean) return true;

    // Suffix match: PID is "SITE-855-PH", request is "855-PH" or "PH"
    if (pidUp.endsWith('-' + reqUp) || (pidClean && pidClean.endsWith(reqClean))) return true;

    // Prefix match: Request has site code prefix "ESK-4417-PH", PID is "PH"
    if (reqUp === `${siteClean}-${pidUp}` || reqClean === `${siteClean}${pidClean}`) return true;
    if (pidUp === `${siteClean}-${reqUp}` || pidClean === `${siteClean}${reqClean}`) return true;

    return false;
  });

  if (match) return match;

  // Tier 2: Custom Name Match (e.g. "Effluent pH Sensor" or "Stack SO2")
  match = siteParams.find((p) => {
    if (!p.name) return false;
    const nameUp = String(p.name).trim().toUpperCase();
    const nameClean = cleanAlphanumeric(nameUp);
    return (
      nameUp === reqUp ||
      (nameClean && nameClean === reqClean) ||
      (nameClean && reqClean && reqClean.length >= 3 && nameClean.includes(reqClean))
    );
  });

  if (match) return match;

  // Tier 3: Parameter Key Match (e.g. "pH", "SOX", "COD", "BOD", with SO2 <-> SOX translation)
  match = siteParams.find((p) => {
    if (!p.key) return false;
    const keyUp = String(p.key).trim().toUpperCase();
    const keyClean = cleanAlphanumeric(keyUp);

    if (keyUp === reqUp || (keyClean && keyClean === reqClean)) return true;

    // Standard OCEMS SO2 / SOX equivalence
    if (keyUp === 'SOX' && (reqUp === 'SO2' || reqClean === 'SO2')) return true;
    if (keyUp === 'SO2' && (reqUp === 'SOX' || reqClean === 'SOX')) return true;

    return false;
  });

  return match || null;
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
    const siteQuery = targetSiteCodes.length
      ? { siteCode: { [Op.in]: targetSiteCodes } }
      : {};

    const sites = await Site.findAll({
      where: siteQuery,
      include: [{ model: Param, as: 'params' }],
      transaction: t,
    });

    const siteMap = new Map(sites.map((s) => [s.siteCode, s]));

    const touchedSiteCodes = new Set();
    const divertedResults = [];
    const skippedResults = [];

    // 2. Divert each parameter reading generically
    for (const r of normalizedReadings) {
      // Determine target site
      let site = null;
      if (forcedSiteCode) {
        site = siteMap.get(forcedSiteCode);
      } else if (r.siteId) {
        site = siteMap.get(r.siteId);
      } else if (sites.length === 1) {
        // If there's only 1 site in DB or configured, default to it
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

      if (isNaN(r.value)) {
        skippedResults.push({
          pid: r.pid,
          value: r.value,
          siteCode: site.siteCode,
          reason: 'Invalid numerical value (NaN)',
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

      const paramJSON = freshParams.map((p) => {
        const plain = p.toJSON();
        return {
          ...plain,
          name: plain.name || plain.key,
        };
      });

      const newSignal = rollup(paramJSON, 'green', site.enabled);

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
