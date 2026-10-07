/* ============================================================
   routes/portal/live.routes.js
   CPCB / SPCB Live Data Transmission Engine
   Endpoint: https://cems.cpcb.gov.in/v1.0/industry/data
   Protocol: ODAMS API v1.0
   Credentials: Station ID, Device ID, Token ID, Public.pem (RSA key)
   ============================================================ */

const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Site, Param, User } = require('../../models');
const logger = require('../../utils/logger');
const PARAMS_REGISTRY = require('../../utils/paramRegistry');

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
function formatIstTimestamp(dateObj = new Date()) {
  // Convert to IST (UTC+05:30)
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

/* ------------------------------------------------------------
   Helper: Generate CPCB ODAMS Signature header
   Message: tokenId + "$*" + timestamp (YYYY-MM-DD HH:MM:SS)
   Encrypted with Public.pem (RSA OAEP SHA-256 or PKCS1)
   ------------------------------------------------------------ */
function generateCpcbSignature(tokenId, publicKeyPem, dateObj = new Date()) {
  const normPem = normalizePublicKey(publicKeyPem);
  if (!normPem) {
    throw new Error('Public.pem RSA key is required to generate the CPCB security signature.');
  }

  const tsStr = formatIstTimestamp(dateObj);
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
function encryptPayloadForCpcb(payloadObj, publicKeyPem) {
  const normPem = normalizePublicKey(publicKeyPem);
  if (!normPem) {
    throw new Error('Public key is missing or invalid.');
  }

  const jsonStr = JSON.stringify(payloadObj);
  const aesKey = crypto.randomBytes(32); // 256-bit AES key
  const iv = crypto.randomBytes(16);     // 16-byte initialization vector

  // AES-256-CBC payload encryption
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  let encryptedData = cipher.update(jsonStr, 'utf8', 'base64');
  encryptedData += cipher.final('base64');

  // RSA Public Key encryption of AES key
  let encryptedKey;
  try {
    encryptedKey = crypto.publicEncrypt(
      {
        key: normPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey
    ).toString('base64');
  } catch (e) {
    encryptedKey = crypto.publicEncrypt(
      {
        key: normPem,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      aesKey
    ).toString('base64');
  }

  return {
    encryptedData,
    encryptedKey,
    iv: iv.toString('base64'),
    keyFingerprint: crypto.createHash('sha256').update(normPem).digest('hex').substring(0, 16),
  };
}

/* ------------------------------------------------------------
   Helper: Gather and format site telemetry for CPCB
   ------------------------------------------------------------ */
async function buildCpcbPayloadData(siteCode, selectedParamKeys = []) {
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
    return selectedParamKeys.includes(p.key) || selectedParamKeys.includes(p.paramId);
  });

  for (const p of activeParams) {
    const registry = PARAMS_REGISTRY[p.key] || {};
    const val = typeof p.value === 'number' ? p.value : parseFloat(p.value) || 0;
    const unit = p.unit || registry.unit || 'mg/Nm3';
    const paramName = (p.name || p.key || '').replace(/SO2/g, 'SOX');

    formattedParams.push({
      parameter: paramName,
      key: p.key,
      value: val,
      unit: unit,
      timestamp: String(nowTs),
      isoTimestamp: isoTime,
      flag: 'U', // 'U' = Valid Data per CPCB OCEMS standards
      limit: p.limit || registry.limit || 0,
    });
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

/* ============================================================
   GET /api/portal/live/config/:siteId
   Retrieve saved CPCB parameters for a site
   ============================================================ */
router.get('/config/:siteId', (req, res) => {
  const configs = loadConfigs();
  const key = req.params.siteId;
  const siteConfig = configs[key] || {
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
   Save CPCB parameters for a site
   ============================================================ */
router.post('/config/:siteId', (req, res) => {
  const { siteId } = req.params;
  const {
    apiUrl,
    stationId,
    deviceId,
    tokenId,
    publicKeyPem,
    publicKeyFileName,
    parameters,
  } = req.body || {};

  const configs = loadConfigs();
  configs[siteId] = {
    apiUrl: apiUrl || 'https://cems.cpcb.gov.in/v1.0/industry/data',
    stationId: (stationId || '').trim(),
    deviceId: (deviceId || '').trim(),
    tokenId: (tokenId || '').trim(),
    publicKeyPem: normalizePublicKey(publicKeyPem) || '',
    publicKeyFileName: publicKeyFileName || (publicKeyPem ? 'Public.pem' : ''),
    parameters: Array.isArray(parameters) ? parameters : [],
    updatedAt: new Date().toISOString(),
  };

  saveConfigs(configs);
  res.json({ ok: true, message: 'CPCB configuration saved for site ' + siteId });
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
      apiUrl = 'https://cems.cpcb.gov.in/v1.0/industry/data',
    } = req.body || {};

    const telemetry = await buildCpcbPayloadData(siteId, parameters);

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
    const telemetry = await buildCpcbPayloadData(siteId, parameters);
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

    // 2. Assemble CPCB Standard Payload
    const cpcbStandardPayload = [
      {
        deviceId: cleanDeviceId,
        params: telemetry.params.map((p) => ({
          parameter: p.parameter,
          value: p.value,
          unit: p.unit,
          timestamp: p.timestamp,
          flag: p.flag,
        })),
      },
    ];

    let requestBody = null;
    let isEncryptedPayload = false;
    let encryptionDetails = null;

    if (payloadMode === 'encrypted') {
      try {
        const enc = encryptPayloadForCpcb(cpcbStandardPayload, publicKeyPem);
        isEncryptedPayload = true;
        encryptionDetails = {
          keyFingerprint: enc.keyFingerprint,
          iv: enc.iv,
        };
        requestBody = {
          stationId: cleanStationId,
          deviceId: cleanDeviceId,
          tokenId: cleanTokenId,
          encryptedData: enc.encryptedData,
          encryptedKey: enc.encryptedKey,
          iv: enc.iv,
          timestamp: telemetry.timestamp,
        };
      } catch (encErr) {
        return res.status(400).json({
          ok: false,
          error: 'Payload encryption failed: ' + encErr.message,
        });
      }
    } else {
      requestBody = cpcbStandardPayload;
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
    let responseText = '';
    let responseJson = null;

    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(18000), // 18-second timeout
      });

      responseText = await response.text();
      try {
        responseJson = JSON.parse(responseText);
      } catch {}
    } catch (networkErr) {
      const duration = Date.now() - startTime;
      logger.warn(`[CPCB HIT] Network error reaching ${apiUrl}: ${networkErr.message}`);

      return res.status(502).json({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway / Network Failure',
        isNetworkError: true,
        error: `Could not reach CPCB server at ${apiUrl}. (${networkErr.message})`,
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

    // Check CPCB response payload for business status
    const cpcbStatus = responseJson && responseJson.status !== undefined ? responseJson.status : null;
    const cpcbMsg = responseJson && responseJson.msg ? responseJson.msg : (responseText || response.statusText);

    // Save last hit info
    try {
      const configs = loadConfigs();
      if (!configs[siteId]) configs[siteId] = {};
      configs[siteId].lastHitAt = new Date().toISOString();
      configs[siteId].lastHitStatus = response.status;
      configs[siteId].lastHitMessage = cpcbMsg;
      saveConfigs(configs);
    } catch {}

    logger.info(`[CPCB HIT] Response from ${apiUrl}: Status ${response.status} (${duration}ms) — ${cpcbMsg}`);

    // Return full transparent response to frontend
    res.status(ok ? 200 : response.status).json({
      ok: ok,
      status: response.status,
      statusText: response.statusText,
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
      encryptionDetails,
      response: responseJson || responseText,
      rawResponseBody: responseText,
      payloadSent: requestBody,
      headersSent: {
        ...headers,
        signature: headers.signature.substring(0, 32) + '...',
        Signature: headers.Signature.substring(0, 32) + '...',
      },
      message: ok
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
