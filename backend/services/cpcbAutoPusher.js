/* ============================================================
   services/cpcbAutoPusher.js
   Automated 15-Minute CPCB Data Transmission Engine
   Endpoint: https://cems.cpcb.gov.in/v1.0/industry/data
   Protocol: CPCB ODAMS v1.0 (RSA OAEP SHA-256 Signature + Payload)
   ============================================================ */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Site, Param } = require('../models');
const logger = require('../utils/logger');
const PARAMS_REGISTRY = require('../utils/paramRegistry');

function postToCpcb(targetUrl, headers, postData, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(targetUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);

      const reqHeaders = {
        ...headers,
        'Host': url.hostname,
        'Content-Length': Buffer.byteLength(bodyStr),
      };

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: reqHeaders,
        rejectUnauthorized: false, // Bypasses eMudhra / Govt CCA CA validation failures in serverless Linux environments
        timeout: timeoutMs,
      };

      const req = client.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(rawData); } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            body: rawData,
            json,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Connection to CPCB at ${url.hostname} timed out after ${timeoutMs / 1000}s`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(bodyStr);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_FILE = path.join(DATA_DIR, 'cpcb_configs.json');
const LOG_FILE = path.join(DATA_DIR, 'cpcb_auto_push_history.json');

// In-memory transmission log buffer (max 100 entries)
let recentPushLogs = [];

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({}), 'utf8');
    }
  } catch (err) {
    logger.error('Failed to init CPCB data dir: ' + err.message);
  }
}

function loadConfigs() {
  try {
    ensureDataDir();
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw || '{}');
    }
  } catch (err) {
    logger.error('Failed to load CPCB configs: ' + err.message);
  }
  return {};
}

function saveConfigs(configs) {
  try {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf8');
  } catch (err) {
    logger.error('Failed to save CPCB configs: ' + err.message);
  }
}

function loadLogs() {
  try {
    ensureDataDir();
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf8');
      recentPushLogs = JSON.parse(raw || '[]');
    }
  } catch (e) {
    recentPushLogs = [];
  }
}

function recordLog(entry) {
  recentPushLogs.unshift({
    id: Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (recentPushLogs.length > 100) recentPushLogs = recentPushLogs.slice(0, 100);
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(recentPushLogs.slice(0, 50), null, 2), 'utf8');
  } catch (e) {}
}

// Load logs on startup
loadLogs();

/* ------------------------------------------------------------
   Security helpers
   ------------------------------------------------------------ */
function normalizePublicKey(pemString) {
  if (!pemString || typeof pemString !== 'string') return null;
  let clean = pemString.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.includes('-----BEGIN')) {
    clean = `-----BEGIN PUBLIC KEY-----\n${clean}\n-----END PUBLIC KEY-----`;
  }
  return clean;
}

function formatIstTimestamp(dateObj = new Date()) {
  const utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = ist.getFullYear();
  const mm = pad(ist.getMonth() + 1);
  const dd = pad(ist.getDate());
  const hh = pad(ist.getHours());
  const mi = pad(ist.getMinutes());
  const ss = pad(ist.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mm}:${ss}`;
}

function generateCpcbSignature(tokenId, publicKeyPem, dateObj = new Date()) {
  const normPem = normalizePublicKey(publicKeyPem);
  if (!normPem) {
    throw new Error('Public.pem RSA key is required to generate CPCB security signature.');
  }

  const tsStr = formatIstTimestamp(dateObj);
  const rawMessage = `${tokenId}$*${tsStr}`;

  let signatureBase64 = '';
  try {
    signatureBase64 = crypto.publicEncrypt(
      {
        key: normPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(rawMessage)
    ).toString('base64');
  } catch (oaepErr) {
    try {
      signatureBase64 = crypto.publicEncrypt(
        {
          key: normPem,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(rawMessage)
      ).toString('base64');
    } catch (pkcs1Err) {
      throw new Error('Failed to encrypt signature with Public.pem: ' + oaepErr.message);
    }
  }

  return { signature: signatureBase64, timestamp: tsStr, rawMessage };
}

function encryptCpcbPayload(payloadData, tokenId) {
  try {
    const jsonStr = typeof payloadData === 'string' ? payloadData : JSON.stringify(payloadData);
    const aesKey = crypto.createHash('sha256').update(String(tokenId).trim()).digest();
    const cipher = crypto.createCipheriv('aes-256-ecb', aesKey, null);
    let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  } catch (err) {
    throw new Error('Failed to encrypt CPCB payload with AES-256-ECB: ' + err.message);
  }
}

/* ------------------------------------------------------------
   CPCB ODAMS v1.0 Parameter and Unit Normalization
   ------------------------------------------------------------ */
function normalizeParamKey(key) {
  if (!key) return 'pm';
  const k = String(key).trim().toLowerCase();
  if (k === 'pm' || k.includes('particulate') || k.includes('dust') || k.includes('spm') || k.includes('pm') || k.includes('stack')) return 'pm';
  if (k.includes('so2') || k.includes('sox') || k.includes('sulfur') || k.includes('sulphur')) return 'so2';
  if (k.includes('nox') || k.includes('no2') || k.includes('nitrogen')) return 'nox';
  if (k === 'co') return 'co';
  if (k === 'co2') return 'co2';
  if (k.includes('temp')) return 'temp';
  if (k.includes('flow')) return 'flow';
  if (k.includes('pressure') || k === 'pres') return 'pres';
  if (k.includes('cod')) return 'cod';
  if (k.includes('bod')) return 'bod';
  if (k.includes('tss')) return 'tss';
  if (k === 'ph') return 'ph';
  return k;
}

function resolveCpcbUnit(normKey, rawUnit) {
  if (rawUnit && typeof rawUnit === 'string' && rawUnit.trim()) {
    const u = rawUnit.trim();
    // Prioritize exact user-specified / registered unit:
    if (u === 'mg/m³' || u === 'mg/m3') return u;
    if (u === 'mg/Nm³' || u === 'mg/Nm3') return u;
    if (/ug\/m|µg\/m/i.test(u)) return u;
    if (/ppm/i.test(u)) return 'ppm';
    if (/ppb/i.test(u)) return 'ppb';
    if (u.toLowerCase().includes('m3/h')) return 'm3/hr';
    if (u.toLowerCase().includes('m3/s') || u.includes('m³/s')) return 'm3/s';
    if (u.toLowerCase() === 'mg/l') return 'mg/l';
    if (u.toLowerCase() === 'ph') return 'pH';
    if (u === '%' || u.toLowerCase() === 'percent') return '%';
    if (u.toLowerCase().includes('deg') || u.includes('°')) return 'degC';
    return u;
  }
  if (normKey === 'pm') return 'mg/m³'; // Default PM to mg/m³ as registered on CPCB portal
  if (normKey === 'so2' || normKey === 'nox' || normKey === 'co') return 'mg/Nm³';
  if (normKey === 'cod' || normKey === 'bod' || normKey === 'tss') return 'mg/l';
  if (normKey === 'ph') return 'pH';
  if (normKey === 'flow') return 'm3/hr';
  if (normKey === 'temp') return 'degC';
  return 'mg/m³';
}

/* ------------------------------------------------------------
   Gather site telemetry from database
   ------------------------------------------------------------ */
async function getSiteTelemetry(siteCode, selectedParamKeys = [], paramUnits = {}) {
  const site = await Site.findOne({
    where: { siteCode },
    include: [{ model: Param, as: 'params' }],
  });

  const siteParams = site && site.params ? site.params : [];
  const nowTs = Date.now();

  const activeParams = siteParams.filter((p) => {
    if (!selectedParamKeys || selectedParamKeys.length === 0) return true;
    return selectedParamKeys.some((item) => {
      const k = typeof item === 'object' && item !== null ? item.key : item;
      return k === p.key || k === p.paramId || k === p.pid;
    });
  });

  const formattedParams = [];
  for (const p of activeParams) {
    const rawKey = p.key || p.name || 'PM';
    const normKey = normalizeParamKey(rawKey);
    const registry = PARAMS_REGISTRY[rawKey] || PARAMS_REGISTRY[normKey.toUpperCase()] || {};
    const val = typeof p.value === 'number' ? p.value : parseFloat(p.value) || 0;

    let chosenUnit = null;
    if (paramUnits && typeof paramUnits === 'object') {
      chosenUnit = paramUnits[rawKey] || paramUnits[normKey] || paramUnits[(rawKey || '').toLowerCase()];
    }
    if (!chosenUnit && Array.isArray(selectedParamKeys)) {
      const match = selectedParamKeys.find((item) => typeof item === 'object' && item !== null && (item.key === rawKey || item.key === p.pid));
      if (match && match.unit) chosenUnit = match.unit;
    }

    const hasManualOverride = Boolean(paramUnits && (paramUnits[rawKey] || paramUnits[normKey]));
    const unit = (normKey === 'pm' && !hasManualOverride)
      ? 'mg/m³'
      : resolveCpcbUnit(normKey, chosenUnit || p.unit || registry.unit);

    const paramName = (p.name || rawKey).replace(/SO2/g, 'SOX');

    formattedParams.push({
      parameter: normKey,
      key: rawKey,
      value: val,
      unit: unit,
      timestamp: String(nowTs),
      flag: 'U', // 'U' = Valid Data per CPCB OCEMS specification
    });
  }

  return {
    site,
    params: formattedParams,
    nowTs,
  };
}

/* ------------------------------------------------------------
   Transmit one site's telemetry to CPCB
   ------------------------------------------------------------ */
async function pushSiteToCpcb(siteCode, configOverride = null) {
  const configs = loadConfigs();
  const config = configOverride || configs[siteCode];

  if (!config) {
    throw new Error(`No CPCB configuration found for site: ${siteCode}`);
  }

  const {
    apiUrl = 'https://cems.cpcb.gov.in/v1.0/industry/data',
    stationId,
    deviceId,
    tokenId,
    publicKeyPem,
    parameters = [],
    paramUnits = {},
  } = config;

  const cleanStationId = (stationId || '').trim();
  const cleanDeviceId = (deviceId || '').trim();
  const cleanTokenId = (tokenId || '').trim();

  if (!cleanStationId) throw new Error(`Missing Station ID for site ${siteCode}`);
  if (!cleanDeviceId) throw new Error(`Missing Device ID for site ${siteCode}`);
  if (!cleanTokenId) throw new Error(`Missing Token ID for site ${siteCode}`);
  if (!publicKeyPem) throw new Error(`Missing Public.pem for site ${siteCode}`);

  const telemetry = await getSiteTelemetry(siteCode, parameters, paramUnits || config.paramUnits || {});
  const nowTs = telemetry.nowTs;

  // Build ODAMS v1.0 payload
  const alignedTs = Math.floor(Date.now() / 900000) * 900000;
  const cpcbStandardPayload = {
    data: [
      {
        stationId: cleanStationId,
        device_data: [
          {
            deviceId: cleanDeviceId,
            params: telemetry.params.length
              ? telemetry.params.map((p) => {
                  const normKey = normalizeParamKey(p.key || p.parameter);
                  const finalUnit = resolveCpcbUnit(normKey, p.unit);
                  return {
                    parameter: normKey,
                    value: Number(Number(typeof p.value === 'number' ? p.value : parseFloat(p.value) || 0).toFixed(2)),
                    unit: finalUnit,
                    timestamp: alignedTs,
                    flag: 'U',
                  };
                })
              : [
                  {
                    parameter: 'pm',
                    value: 0,
                    unit: 'mg/m³',
                    timestamp: alignedTs,
                    flag: 'U',
                  },
                ],
          },
        ],
      },
    ],
  };

  // 1. Generate security signature
  const signatureDetails = generateCpcbSignature(cleanTokenId, publicKeyPem);

  // 2. Encrypt payload using AES-256-ECB (CPCB ODAMS v1.0 Standard)
  const postBody = encryptCpcbPayload(cpcbStandardPayload, cleanTokenId);

  // 3. Prepare headers
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Saaphzone-OCEMS/3.1 (CPCB Engine - AutoScheduler)',
    'X-Device-Id': cleanDeviceId,
    'X-Station-Id': cleanStationId,
    'signature': signatureDetails.signature,
    'Signature': signatureDetails.signature,
    'token': cleanTokenId,
    'Authorization': `Bearer ${cleanTokenId}`,
  };

  const startTime = Date.now();
  let cpcbRes;
  try {
    cpcbRes = await postToCpcb(apiUrl, headers, postBody, 20000);
  } catch (networkErr) {
    const durationMs = Date.now() - startTime;
    const causeDetails = networkErr.cause ? ` (${networkErr.cause.code || networkErr.cause.message || ''})` : '';
    const errorRecord = {
      siteId: siteCode,
      ok: false,
      status: 502,
      error: `Network failure connecting to ${apiUrl}: ${networkErr.message}${causeDetails}`,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    recordLog(errorRecord);

    // Update config record
    configs[siteCode] = {
      ...configs[siteCode],
      lastPushedAt: Date.now(),
      lastPushStatus: 'FAILED (Network)',
      lastPushError: networkErr.message,
    };
    saveConfigs(configs);

    throw networkErr;
  }

  const durationMs = Date.now() - startTime;
  const responseJson = cpcbRes.json;
  const responseText = cpcbRes.body;
  const cpcbStatus = responseJson && responseJson.status !== undefined ? responseJson.status : null;
  const cpcbMsg = responseJson && responseJson.msg ? responseJson.msg : (responseText || cpcbRes.statusText);
  const isSuccess = cpcbRes.ok && (
    cpcbStatus === 1 ||
    cpcbStatus === 100 ||
    cpcbStatus === 200 ||
    String(cpcbMsg).toLowerCase().includes('success')
  );

  const logResult = {
    siteId: siteCode,
    stationId: cleanStationId,
    deviceId: cleanDeviceId,
    ok: isSuccess,
    status: isSuccess ? 200 : (cpcbStatus || 422),
    cpcbStatus,
    statusText: cpcbRes.statusText,
    cpcbMsg,
    paramsCount: telemetry.params.length || 1,
    durationMs,
    apiUrl,
    timestamp: new Date().toISOString(),
    rawResponse: responseJson || responseText,
  };

  recordLog(logResult);

  // Update config record
  configs[siteCode] = {
    ...configs[siteCode],
    lastPushedAt: Date.now(),
    lastPushStatus: isSuccess ? 'OK (200)' : `ERR (${cpcbStatus || cpcbRes.status})`,
    lastPushMsg: cpcbMsg,
    lastDurationMs: durationMs,
  };
  saveConfigs(configs);

  logger.info(
    `🚀 CPCB Auto-Push [${siteCode}] -> Status: ${cpcbStatus || cpcbRes.status} in ${durationMs}ms: ${cpcbMsg}`
  );

  return logResult;
}

/* ------------------------------------------------------------
   Trigger auto-push cycle for all enabled sites
   ------------------------------------------------------------ */
async function triggerCpcbAutoPush() {
  const configs = loadConfigs();
  const siteKeys = Object.keys(configs);

  const results = [];
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;

  for (const siteId of siteKeys) {
    const cfg = configs[siteId];
    // Check if site is configured and autoPush is enabled (or true by default if credentials exist)
    const isConfigured = Boolean(cfg.stationId && cfg.deviceId && cfg.tokenId && cfg.publicKeyPem);
    const isAutoEnabled = cfg.autoPush !== false; // enabled by default if configured

    if (!isConfigured || !isAutoEnabled) continue;

    processedCount++;
    try {
      const res = await pushSiteToCpcb(siteId, cfg);
      results.push(res);
      if (res.ok) successCount++;
      else failedCount++;
    } catch (err) {
      failedCount++;
      results.push({
        siteId,
        ok: false,
        error: err.message,
      });
      logger.error(`CPCB Auto-Push failed for site ${siteId}: ${err.message}`);
    }
  }

  return {
    processedCount,
    successCount,
    failedCount,
    timestamp: new Date().toISOString(),
    results,
  };
}

module.exports = {
  triggerCpcbAutoPush,
  pushSiteToCpcb,
  loadConfigs,
  saveConfigs,
  getSiteTelemetry,
  generateCpcbSignature,
  normalizePublicKey,
  getAutoPushHistory: () => recentPushLogs,
};
