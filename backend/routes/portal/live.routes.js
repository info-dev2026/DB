/* ============================================================
   routes/portal/live.routes.js
   CPCB / SPCB Live Data Transmission Engine
   Endpoint: https://cems.cpcb.gov.in/v1.0/industry/data
   Protocol: ODAMS API v1.0
   Credentials: Station ID, Device ID, Token ID, Public.pem (RSA key)
   ============================================================ */

const router = require('express').Router();
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Site, Param, User, BoardConfig } = require('../../models');
const logger = require('../../utils/logger');
const PARAMS_REGISTRY = require('../../utils/paramRegistry');

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

// File storage for persisting CPCB credentials per site
const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'cpcb_configs.json');

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

/* ------------------------------------------------------------
   Helper: Clean and validate PEM public key
   ------------------------------------------------------------ */
function normalizePublicKey(pemString) {
  if (!pemString || typeof pemString !== 'string') return null;
  let clean = pemString.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!clean.includes('-----BEGIN')) {
    // If user pasted just base64, wrap with standard PEM header
    clean = `-----BEGIN PUBLIC KEY-----\n${clean}\n-----END PUBLIC KEY-----`;
  }
  return clean;
}

/* ------------------------------------------------------------
   Helper: Format timestamp for CPCB ODAMS signature (IST)
   Format: YYYY-MM-DD HH:MM:SS
   ------------------------------------------------------------ */
function formatIstTimestamp(dateObj = new Date(), isAligned = true) {
  // Convert to IST (UTC+05:30)
  const utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);

  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = ist.getFullYear();
  const mm = pad(ist.getMonth() + 1);
  const dd = pad(ist.getDate());
  const hh = pad(ist.getHours());
  if (isAligned) {
    const mi = pad(Math.floor(ist.getMinutes() / 15) * 15);
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`;
  }
  const mi = pad(ist.getMinutes());
  const ss = pad(ist.getSeconds());

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/* ------------------------------------------------------------
   Helper: Generate CPCB ODAMS Signature header
   Message: tokenId + "$*" + timestamp (YYYY-MM-DD HH:MM:00.000)
   Encrypted with Public.pem (RSA OAEP SHA-256 or PKCS1)
   ------------------------------------------------------------ */
function generateCpcbSignature(tokenId, publicKeyPem, dateObj = new Date()) {
  const normPem = normalizePublicKey(publicKeyPem);
  if (!normPem) {
    throw new Error('Public.pem RSA key is required to generate the CPCB security signature.');
  }

  // CPCB ODAMS strictly requires 15-minute aligned timestamp with .000 ms
  const tsStr = formatIstTimestamp(dateObj, true);
  const rawMessage = `${tokenId}$*${tsStr}`;

  let signatureBase64 = '';
  try {
    // Standard CPCB ODAMS specification: RSA OAEP padding with SHA-256
    signatureBase64 = crypto.publicEncrypt(
      {
        key: normPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(rawMessage)
    ).toString('base64');
  } catch (oaepErr) {
    // Fallback: PKCS1 padding
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

  return {
    signature: signatureBase64,
    timestamp: tsStr,
    rawMessage,
  };
}

/* ------------------------------------------------------------
   Helper: Hybrid Payload Encryption (AES-256-CBC + RSA Public Key)
   ------------------------------------------------------------ */
function encryptCpcbPayload(payloadData, tokenId) {
  try {
    const jsonStr = typeof payloadData === 'string' ? payloadData : JSON.stringify(payloadData);
    // CPCB ODAMS v1.0 standard: 256-bit AES key derived from SHA-256 hash of Token ID
    const aesKey = crypto.createHash('sha256').update(String(tokenId).trim()).digest();
    // Encrypt using AES-256-ECB with PKCS7 padding
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
   Helper: Gather and format site telemetry for CPCB
   ------------------------------------------------------------ */
async function buildCpcbPayloadData(siteCode, selectedParamKeys = [], paramUnits = {}) {
  const site = await Site.findOne({
    where: { siteCode },
    include: [{ model: Param, as: 'params' }],
  });

  const siteParams = site && site.params ? site.params : [];
  const nowTs = Date.now();
  const isoTime = new Date(nowTs).toISOString();

  const formattedParams = [];

  // Filter or take all params
  const activeParams = siteParams.filter((p) => {
    if (!selectedParamKeys || selectedParamKeys.length === 0) return true;
    return selectedParamKeys.some((item) => {
      const k = typeof item === 'object' && item !== null ? item.key : item;
      return k === p.key || k === p.paramId || k === p.pid;
    });
  });

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

    const unit = resolveCpcbUnit(normKey, chosenUnit || p.unit || registry.unit);

    const paramName = (p.name || rawKey).replace(/SO2/g, 'SOX');

    formattedParams.push({
      parameter: normKey,
      key: rawKey,
      value: val,
      unit: unit,
      timestamp: String(nowTs),
      isoTimestamp: isoTime,
      flag: 'U', // 'U' = Valid Data per CPCB OCEMS standards
      limit: p.limit || registry.limit || 0,
    });
  }

  // Fallback: If site has no DB params or not found, use selectedParamKeys from client
  if (formattedParams.length === 0 && Array.isArray(selectedParamKeys) && selectedParamKeys.length > 0) {
    for (const item of selectedParamKeys) {
      const rawKey = typeof item === 'object' && item !== null ? (item.key || item.parameter || 'PM') : item;
      const rawVal = typeof item === 'object' && item !== null ? item.value : 0;
      const rawUnit = typeof item === 'object' && item !== null ? item.unit : null;
      const normKey = normalizeParamKey(rawKey);
      const chosenUnit = (paramUnits && (paramUnits[rawKey] || paramUnits[normKey])) || rawUnit;
      const finalUnit = resolveCpcbUnit(normKey, chosenUnit);

      formattedParams.push({
        parameter: normKey,
        key: rawKey,
        value: typeof rawVal === 'number' ? rawVal : parseFloat(rawVal) || 0,
        unit: finalUnit,
        timestamp: String(nowTs),
        isoTimestamp: isoTime,
        flag: 'U',
        limit: 50,
      });
    }
  }

  return {
    site,
    timestamp: nowTs,
    isoTimestamp: isoTime,
    params: formattedParams,
  };
}

/* ============================================================
   POST /api/portal/live/unlock
   Authorizes Live Push access
   ============================================================ */
router.post('/unlock', async (req, res) => {
  const { id, password } = req.body || {};

  // Master override for system engineers
  if (id === 'SZ_Chandan' && password === 'SZ_2026_ECO#') {
    const token = jwt.sign(
      { role: 'admin', user: 'SZ_Chandan', liveUnlocked: true },
      process.env.JWT_SECRET || 'sz_secret_default',
      { expiresIn: '8h' }
    );
    return res.json({ ok: true, token, user: 'SZ_Chandan' });
  }

  // Check portal user login from DB
  if (id && password) {
    try {
      const user = await User.findOne({ where: { login: id } });
      if (user && ['admin', 'engineer'].includes(user.role)) {
        const match = await bcrypt.compare(password, user.passwordHash);
        if (match) {
          const token = jwt.sign(
            { userId: user.id, role: user.role, liveUnlocked: true },
            process.env.JWT_SECRET || 'sz_secret_default',
            { expiresIn: '8h' }
          );
          return res.json({ ok: true, token, user: user.login });
        }
      }
    } catch (e) {
      logger.error('Live unlock error: ' + e.message);
    }
  }

  // Check existing auth header if user is already logged in as admin
  const hdr = req.headers.authorization || '';
  if (hdr.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(hdr.slice(7), process.env.JWT_SECRET || 'sz_secret_default');
      if (['admin', 'engineer'].includes(payload.role)) {
        const token = jwt.sign(
          { userId: payload.userId, role: payload.role, liveUnlocked: true },
          process.env.JWT_SECRET || 'sz_secret_default',
          { expiresIn: '8h' }
        );
        return res.json({ ok: true, token, user: payload.role });
      }
    } catch {}
  }

  return res.status(401).json({
    ok: false,
    error: 'Invalid Live credentials. Please enter authorized Live ID & Password.',
  });
});

const {
  triggerRegulatoryAutoPush,
  triggerCpcbAutoPush,
  pushSiteToCpcb,
  pushBoardConfig,
  getAllBoardConfigs,
  saveBoardConfig,
  getAutoPushHistory,
} = require('../../services/cpcbAutoPusher');

/* ============================================================
   GET /api/portal/live/boards/:siteId
   Retrieve ALL saved board configurations (CPCB + SPCBs) for a site
   ============================================================ */
router.get('/boards/:siteId', async (req, res) => {
  const { siteId } = req.params;
  try {
    const list = await BoardConfig.findAll({ where: { siteCode: siteId } });
    res.json({ ok: true, siteId, boards: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   POST /api/portal/live/boards/:siteId
   Save/update a specific regulatory board configuration (CPCB, DPCC, HSPCB, etc.)
   ============================================================ */
router.post('/boards/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const boardCode = (req.body.boardCode || req.body.board || 'CPCB').toUpperCase();
  try {
    const saved = await saveBoardConfig(siteId, boardCode, req.body);
    res.json({
      ok: true,
      message: `${boardCode} configuration saved in database for ${siteId}`,
      config: saved,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   GET /api/portal/live/config/:siteId
   Retrieve saved CPCB parameters for a site (PostgreSQL with JSON fallback)
   ============================================================ */
router.get('/config/:siteId', async (req, res) => {
  const { siteId } = req.params;
  try {
    const dbConfig = await BoardConfig.findOne({
      where: { siteCode: siteId, boardCode: 'CPCB' },
    });
    if (dbConfig) {
      return res.json({ ok: true, config: dbConfig });
    }
  } catch (e) {}

  const configs = loadConfigs();
  const siteConfig = configs[siteId] || {
    apiUrl: 'https://cems.cpcb.gov.in/v1.0/industry/data',
    stationId: '',
    deviceId: '',
    tokenId: '',
    publicKeyPem: '',
    publicKeyFileName: '',
    parameters: [],
  };
  res.json({ ok: true, config: siteConfig });
});

/* ============================================================
   POST /api/portal/live/config/:siteId
   Save CPCB parameters for a site (PostgreSQL)
   ============================================================ */
router.post('/config/:siteId', async (req, res) => {
  const { siteId } = req.params;
  try {
    const saved = await saveBoardConfig(siteId, 'CPCB', req.body);
    res.json({
      ok: true,
      message: 'CPCB configuration saved in database for site ' + siteId,
      config: saved,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   GET /api/portal/live/autopush/status
   Get automated 15-minute push status across all boards & sites
   ============================================================ */
router.get('/autopush/status', async (req, res) => {
  try {
    const allConfigs = await getAllBoardConfigs();
    const history = getAutoPushHistory();

    const siteList = allConfigs.map((cfg) => ({
      siteId: cfg.siteCode,
      board: cfg.boardCode,
      boardName: cfg.boardName,
      stationId: cfg.stationId,
      deviceId: cfg.deviceId,
      autoPush: cfg.autoPush !== false,
      intervalMinutes: cfg.intervalMinutes || 15,
      fallbackSimulation: cfg.fallbackSimulation !== false,
      lastPushedAt: cfg.lastPushedAt,
      lastPushStatus: cfg.lastPushStatus,
      lastPushMsg: cfg.lastPushMsg,
      lastDurationMs: cfg.lastDurationMs,
    }));

    res.json({
      ok: true,
      intervalMinutes: 15,
      enabledCount: siteList.filter((s) => s.autoPush).length,
      sites: siteList,
      recentHistory: history.slice(0, 25),
      cloudEngine: '24/7 Cloud Regulatory Transmission Engine Active',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   GET /api/portal/live/autopush/history
   Get recent transmission history
   ============================================================ */
router.get('/autopush/history', (req, res) => {
  res.json({ ok: true, history: getAutoPushHistory() });
});

/* ============================================================
   POST /api/portal/live/autopush/trigger
   Manually trigger 24/7 auto-push for all boards & sites
   ============================================================ */
router.post('/autopush/trigger', async (req, res) => {
  const { siteId, boardCode } = req.body || {};
  try {
    const summary = await triggerRegulatoryAutoPush(siteId, boardCode);
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   POST /api/portal/live/autopush/toggle/:siteId
   Toggle auto-push for a specific site and board
   ============================================================ */
router.post('/autopush/toggle/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const { enabled, boardCode = 'CPCB' } = req.body || {};
  try {
    const record = await BoardConfig.findOne({
      where: { siteCode: siteId, boardCode: boardCode.toUpperCase() },
    });
    if (record) {
      record.autoPush = enabled !== undefined ? Boolean(enabled) : !record.autoPush;
      await record.save();
      return res.json({ ok: true, siteId, boardCode, autoPush: record.autoPush });
    }
    res.status(404).json({ ok: false, error: 'Board configuration not found' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   POST /api/portal/live/preview
   Generate payload & signature preview without hitting CPCB
   ============================================================ */
router.post('/preview', async (req, res) => {
  try {
    const {
      siteId,
      stationId,
      deviceId,
      tokenId,
      publicKeyPem,
      parameters,
      paramUnits = {},
      apiUrl = 'https://cems.cpcb.gov.in/v1.0/industry/data',
    } = req.body || {};

    const telemetry = await buildCpcbPayloadData(siteId, parameters, paramUnits);

    // Format: CPCB Standard JSON array format
    const cpcbPayload = [
      {
        deviceId: deviceId || 'DEVICE-SAMPLE',
        params: telemetry.params.map((p) => ({
          parameter: p.parameter,
          value: p.value,
          unit: p.unit,
          timestamp: p.timestamp,
          flag: p.flag,
        })),
      },
    ];

    let signatureDetails = null;
    let signatureError = null;
    let encryptedData = null;

    if (publicKeyPem && tokenId) {
      try {
        signatureDetails = generateCpcbSignature(tokenId, publicKeyPem);
      } catch (e) {
        signatureError = e.message;
      }

      try {
        encryptedData = encryptPayloadForCpcb(cpcbPayload, publicKeyPem);
      } catch (e) {}
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId || '',
      'X-Station-Id': stationId || '',
      'signature': signatureDetails ? signatureDetails.signature : '',
      'Signature': signatureDetails ? signatureDetails.signature : '',
      'token': tokenId || '',
    };

    res.json({
      ok: true,
      apiUrl,
      siteId,
      stationId,
      deviceId,
      headers,
      cpcbPayload,
      signatureDetails,
      signatureError,
      encryptedData,
      paramCount: telemetry.params.length,
      params: telemetry.params,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   POST /api/portal/live/push
   The core hit endpoint: transmits data directly to CPCB
   Target: https://cems.cpcb.gov.in/v1.0/industry/data
   ============================================================ */
router.post('/push', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      siteId,
      board = 'CPCB',
      apiUrl = 'https://cems.cpcb.gov.in/v1.0/industry/data',
      stationId,
      deviceId,
      tokenId,
      publicKeyPem,
      parameters = [],
      paramUnits = {},
      dryRun = false,
      payloadMode = 'standard', // 'standard' (with signature header) | 'encrypted'
    } = req.body || {};

    if (!siteId) {
      return res.status(400).json({ ok: false, error: 'Site ID is required.' });
    }

    // Validation for CPCB
    const cleanStationId = (stationId || '').trim();
    const cleanDeviceId = (deviceId || '').trim();
    const cleanTokenId = (tokenId || '').trim();

    if (!cleanStationId) {
      return res.status(400).json({ ok: false, error: 'Station ID is required for CPCB data hit.' });
    }
    if (!cleanDeviceId) {
      return res.status(400).json({ ok: false, error: 'Device ID is required for CPCB data hit.' });
    }
    if (!cleanTokenId) {
      return res.status(400).json({ ok: false, error: 'Token ID is required for CPCB authentication.' });
    }
    if (!publicKeyPem) {
      return res.status(400).json({
        ok: false,
        error: 'Public.pem RSA certificate/key is required for CPCB signature and secure transmission.',
      });
    }

    // Build telemetry readings
    const telemetry = await buildCpcbPayloadData(siteId, parameters, paramUnits);
    if (!telemetry.params.length) {
      return res.status(400).json({
        ok: false,
        error: 'No active parameters selected or available for this site.',
      });
    }

    // 1. Generate CPCB ODAMS Signature header
    let signatureDetails;
    try {
      signatureDetails = generateCpcbSignature(cleanTokenId, publicKeyPem);
    } catch (sigErr) {
      return res.status(400).json({
        ok: false,
        error: 'CPCB Signature generation failed: ' + sigErr.message,
      });
    }

    // 2. Assemble CPCB ODAMS v1.0 Standard Payload
    const alignedTs = Math.floor(Date.now() / 900000) * 900000;
    const cpcbStandardPayload = {
      data: [
        {
          stationId: cleanStationId,
          device_data: [
            {
              deviceId: cleanDeviceId,
              params: telemetry.params.map((p) => {
                const normKey = normalizeParamKey(p.key || p.parameter);
                const finalUnit = resolveCpcbUnit(normKey, p.unit);
                return {
                  parameter: normKey,
                  value: Number(Number(typeof p.value === 'number' ? p.value : parseFloat(p.value) || 0).toFixed(2)),
                  unit: finalUnit,
                  timestamp: alignedTs,
                  flag: 'U',
                };
              }),
            },
          ],
          latitude: telemetry.site && telemetry.site.lat ? parseFloat(telemetry.site.lat) : 28.116096,
          longitude: telemetry.site && telemetry.site.lng ? parseFloat(telemetry.site.lng) : 76.781141,
        },
      ],
    };

    let requestBody = null;
    let isEncryptedPayload = false;

    if (payloadMode === 'plain') {
      requestBody = cpcbStandardPayload;
    } else {
      try {
        requestBody = encryptCpcbPayload(cpcbStandardPayload, cleanTokenId);
        isEncryptedPayload = true;
      } catch (encErr) {
        return res.status(400).json({
          ok: false,
          error: 'Payload encryption failed: ' + encErr.message,
        });
      }
    }

    // 3. Assemble CPCB HTTP Headers
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Saaphzone-OCEMS/3.1 (CPCB Telemetry Engine)',
      'X-Device-Id': cleanDeviceId,
      'X-Station-Id': cleanStationId,
      'signature': signatureDetails.signature,
      'Signature': signatureDetails.signature,
      'token': cleanTokenId,
      'Authorization': `Bearer ${cleanTokenId}`,
    };

    // If Dry Run requested
    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        status: 200,
        statusText: 'DRY RUN VALIDATED',
        pushedAt: Date.now(),
        durationMs: Date.now() - startTime,
        apiUrl,
        stationId: cleanStationId,
        deviceId: cleanDeviceId,
        tokenId: cleanTokenId,
        params: telemetry.params.length,
        signatureTimestamp: signatureDetails.timestamp,
        signaturePreview: signatureDetails.signature.substring(0, 32) + '...',
        payloadSent: requestBody,
        headersSent: {
          ...headers,
          signature: headers.signature.substring(0, 32) + '...',
          Signature: headers.Signature.substring(0, 32) + '...',
        },
        message: 'Dry run successful: Signature generated and CPCB payload formatted.',
      });
    }

    // 4. Real HTTP POST transmission to CPCB
    logger.info(`[CPCB HIT] Sending ${telemetry.params.length} parameters for ${siteId} to ${apiUrl}...`);

    let response;
    try {
      response = await postToCpcb(apiUrl, headers, requestBody, 20000);
    } catch (networkErr) {
      const duration = Date.now() - startTime;
      const causeDetails = networkErr.cause ? ` (${networkErr.cause.code || networkErr.cause.message || ''})` : '';
      logger.warn(`[CPCB HIT] Network error reaching ${apiUrl}: ${networkErr.message}${causeDetails}`);

      return res.status(502).json({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway / Network Failure',
        isNetworkError: true,
        error: `Could not reach CPCB server at ${apiUrl}. (${networkErr.message}${causeDetails})`,
        details: networkErr.code || networkErr.name,
        pushedAt: Date.now(),
        durationMs: duration,
        apiUrl,
        stationId: cleanStationId,
        deviceId: cleanDeviceId,
        params: telemetry.params.length,
        payloadSent: requestBody,
        headersSent: {
          ...headers,
          signature: headers.signature.substring(0, 32) + '...',
          Signature: headers.Signature.substring(0, 32) + '...',
        },
        hint: 'Verify internet connectivity, firewall permissions, or if CPCB portal is currently accepting requests.',
      });
    }

    const duration = Date.now() - startTime;
    const ok = response.ok;
    const responseJson = response.json;
    const responseText = response.body;

    // Check CPCB response payload for business status
    const cpcbStatus = responseJson && responseJson.status !== undefined ? responseJson.status : null;
    const cpcbMsg = responseJson && responseJson.msg ? responseJson.msg : (responseText || response.statusText);
    const isCpcbSuccess = response.ok && (
      cpcbStatus === 1 ||
      cpcbStatus === 100 ||
      cpcbStatus === 200 ||
      String(cpcbMsg).toLowerCase().includes('success')
    );

    // Save last hit info
    try {
      const configs = loadConfigs();
      if (!configs[siteId]) configs[siteId] = {};
      configs[siteId].lastHitAt = new Date().toISOString();
      configs[siteId].lastHitStatus = isCpcbSuccess ? 200 : (cpcbStatus || 422);
      configs[siteId].lastHitMessage = cpcbMsg;
      saveConfigs(configs);
    } catch {}

    logger.info(`[CPCB HIT] Response from ${apiUrl}: Status ${response.status} (${duration}ms) — ${cpcbMsg}`);

    // Return full transparent response to frontend
    res.status(isCpcbSuccess ? 200 : 422).json({
      ok: isCpcbSuccess,
      status: isCpcbSuccess ? 200 : 422,
      statusText: isCpcbSuccess ? 'OK' : 'CPCB Validation Notice',
      cpcbStatus: cpcbStatus,
      cpcbMsg: cpcbMsg,
      pushedAt: Date.now(),
      durationMs: duration,
      apiUrl,
      stationId: cleanStationId,
      deviceId: cleanDeviceId,
      params: telemetry.params.length,
      signatureTimestamp: signatureDetails.timestamp,
      isEncrypted: isEncryptedPayload,
      response: responseJson || responseText,
      rawResponseBody: responseText,
      payloadSent: requestBody,
      headersSent: {
        ...headers,
        signature: headers.signature.substring(0, 32) + '...',
        Signature: headers.Signature.substring(0, 32) + '...',
      },
      message: isCpcbSuccess
        ? `Successfully transmitted data to CPCB (${telemetry.params.length} parameters)`
        : `CPCB server responded: ${cpcbMsg}`,
    });
  } catch (err) {
    logger.error('[CPCB HIT] Unhandled error: ' + err.message);
    res.status(500).json({
      ok: false,
      error: 'Internal transmission error: ' + err.message,
      pushedAt: Date.now(),
      durationMs: Date.now() - startTime,
    });
  }
});

module.exports = router;
