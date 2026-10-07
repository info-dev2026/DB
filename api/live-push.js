/* ============================================================
   api/live-push.js
   Vercel Serverless Function for CPCB Live Data Transmission
   Handles: https://cems.cpcb.gov.in/v1.0/industry/data
   Allows dashboard.saaphzone.com to hit CPCB directly with
   zero dependencies on external backend deployment state.
   ============================================================ */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

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

function normalizeParamKey(key) {
  if (!key) return 'pm';
  const k = String(key).trim().toLowerCase();
  if (k === 'pm' || k.includes('particulate') || k.includes('dust') || k.includes('spm')) return 'pm';
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
    if (/^mg\/n(m|m3|\^3)$/i.test(u) || u.toLowerCase() === 'mg/nm3') return 'mg/Nm3';
    if (/^mg\/(m|m3|\^3)$/i.test(u) || u.toLowerCase() === 'mg/m3') return 'mg/m3';
    if (u.toLowerCase().includes('ug/m') || u.includes('µg/m')) return 'ug/m3';
    if (u.toLowerCase() === 'ppm') return 'ppm';
    if (u.toLowerCase() === 'ppb') return 'ppb';
    if (u.toLowerCase().includes('m3/h')) return 'm3/hr';
    if (u.toLowerCase() === 'mg/l') return 'mg/l';
    if (u.toLowerCase() === 'ph') return 'pH';
    if (u === '%' || u.toLowerCase() === 'percent') return '%';
    if (u.toLowerCase().includes('deg') || u.includes('°')) return 'degC';
    return u;
  }
  if (normKey === 'pm') return 'mg/m3';
  if (normKey === 'so2' || normKey === 'nox' || normKey === 'co') return 'mg/Nm3';
  if (normKey === 'cod' || normKey === 'bod' || normKey === 'tss') return 'mg/l';
  if (normKey === 'ph') return 'pH';
  if (normKey === 'flow') return 'm3/hr';
  if (normKey === 'temp') return 'degC';
  return 'mg/m3';
}

function get15MinuteAlignedTimestamp(dateObj = new Date()) {
  const ms = dateObj.getTime();
  const slotMs = 15 * 60 * 1000;
  return Math.floor(ms / slotMs) * slotMs;
}

module.exports = async (req, res) => {
  // Set CORS headers so dashboard.saaphzone.com can communicate seamlessly
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Device-Id, X-Station-Id, token, signature, Signature'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    // 15-Minute Cron Trigger or Service Health
    try {
      fetch('https://saaphzone-backend.onrender.com/api/portal/live/autopush/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    } catch (e) {}

    return res.status(200).json({
      ok: true,
      service: 'CPCB 15-Minute Auto-Push Engine',
      cronSchedule: '*/15 * * * *',
      intervalMinutes: 15,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const startTime = Date.now();
  try {
    const {
      siteId,
      apiUrl = 'https://cems.cpcb.gov.in/v1.0/industry/data',
      stationId,
      deviceId,
      tokenId,
      publicKeyPem,
      parameters = [],
      paramUnits = {},
      dryRun = false,
      payloadMode = 'standard',
    } = req.body || {};

    const cleanStationId = (stationId || '').trim();
    const cleanDeviceId = (deviceId || '').trim();
    const cleanTokenId = (tokenId || '').trim();

    if (!cleanStationId) return res.status(400).json({ ok: false, error: 'Station ID is required for CPCB data hit.' });
    if (!cleanDeviceId) return res.status(400).json({ ok: false, error: 'Device ID is required for CPCB data hit.' });
    if (!cleanTokenId) return res.status(400).json({ ok: false, error: 'Token ID is required for CPCB authentication.' });
    if (!publicKeyPem) return res.status(400).json({ ok: false, error: 'Public.pem is required for CPCB encryption & signature.' });

    // Generate CPCB ODAMS signature
    const signatureDetails = generateCpcbSignature(cleanTokenId, publicKeyPem);

    // Format CPCB ODAMS v1.0 standard payload
    const alignedTs = get15MinuteAlignedTimestamp();
    const reqParamUnits = (paramUnits && typeof paramUnits === 'object') ? paramUnits : {};

    const formattedParams = (parameters || []).map((p) => {
      const pObj = typeof p === 'object' && p !== null ? p : { key: p };
      const rawKey = pObj.key || pObj.name || 'pm';
      const normKey = normalizeParamKey(rawKey);
      const val = typeof pObj.value === 'number' ? pObj.value : parseFloat(pObj.value) || 0;

      // Check explicit manual unit override
      let chosenUnit = null;
      if (reqParamUnits[rawKey] && String(reqParamUnits[rawKey]).trim()) {
        chosenUnit = String(reqParamUnits[rawKey]).trim();
      } else if (reqParamUnits[normKey] && String(reqParamUnits[normKey]).trim()) {
        chosenUnit = String(reqParamUnits[normKey]).trim();
      } else if (pObj.unit && typeof pObj.unit === 'string' && pObj.unit.trim()) {
        chosenUnit = pObj.unit.trim();
      }

      const unit = chosenUnit || resolveCpcbUnit(normKey, pObj.unit);
      return {
        parameter: normKey,
        value: Number(Number(val).toFixed(2)),
        unit: unit,
        timestamp: alignedTs,
        flag: 'U',
      };
    });

    const cpcbStandardPayload = {
      data: [
        {
          stationId: cleanStationId,
          device_data: [
            {
              deviceId: cleanDeviceId,
              params: formattedParams.length
                ? formattedParams
                : [
                    {
                      parameter: 'pm',
                      value: 0,
                      unit: 'mg/m3',
                      timestamp: alignedTs,
                      flag: 'U',
                    },
                  ],
            },
          ],
        },
      ],
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Saaphzone-OCEMS/3.1 (CPCB Engine)',
      'X-Device-Id': cleanDeviceId,
      'X-Station-Id': cleanStationId,
      'signature': signatureDetails.signature,
      'Signature': signatureDetails.signature,
      'token': cleanTokenId,
      'Authorization': `Bearer ${cleanTokenId}`,
    };

    const isPlainMode = payloadMode === 'plain';
    let postBody;
    let encryptedPreview = null;
    if (isPlainMode) {
      postBody = JSON.stringify(cpcbStandardPayload);
    } else {
      postBody = encryptCpcbPayload(cpcbStandardPayload, cleanTokenId);
      encryptedPreview = postBody.substring(0, 32) + '...';
    }

    const isDryRun = Boolean(dryRun || (req.url && req.url.includes('preview')));

    if (isDryRun) {
      return res.status(200).json({
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
        params: formattedParams.length || 1,
        payloadMode: isPlainMode ? 'plain' : 'encrypted',
        signatureTimestamp: signatureDetails.timestamp,
        signaturePreview: signatureDetails.signature.substring(0, 32) + '...',
        encryptedPayloadPreview: encryptedPreview,
        cpcbPayload: cpcbStandardPayload,
        payloadSent: cpcbStandardPayload,
        headers: headers,
        headersSent: {
          ...headers,
          signature: headers.signature.substring(0, 32) + '...',
          Signature: headers.Signature.substring(0, 32) + '...',
        },
        message: 'Dry run successful: Signature generated and CPCB ODAMS payload formatted.',
      });
    }

    // Direct HTTPS POST transmission to CPCB (bypassing Linux container CA verification issue)
    let cpcbRes;
    try {
      cpcbRes = await postToCpcb(apiUrl, headers, postBody, 20000);
    } catch (networkErr) {
      const causeDetails = networkErr.cause ? ` (${networkErr.cause.code || networkErr.cause.message || ''})` : '';
      return res.status(502).json({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway / Network Failure',
        isNetworkError: true,
        region: process.env.VERCEL_REGION || 'bom1',
        error: `Could not reach CPCB server at ${apiUrl}. (${networkErr.message}${causeDetails})`,
        details: networkErr.code || networkErr.name,
        pushedAt: Date.now(),
        durationMs: Date.now() - startTime,
        apiUrl,
        stationId: cleanStationId,
        deviceId: cleanDeviceId,
        params: formattedParams.length || 1,
        payloadSent: cpcbStandardPayload,
        headersSent: {
          ...headers,
          signature: headers.signature.substring(0, 32) + '...',
          Signature: headers.Signature.substring(0, 32) + '...',
        },
        hint: 'Verify internet connectivity, firewall permissions, or if CPCB portal is currently accepting requests.',
      });
    }

    const duration = Date.now() - startTime;
    const responseJson = cpcbRes.json;
    const responseText = cpcbRes.body;
    const cpcbStatus = responseJson && responseJson.status !== undefined ? responseJson.status : null;
    const cpcbMsg = responseJson && responseJson.msg ? responseJson.msg : (responseText || cpcbRes.statusText);

    // In CPCB ODAMS v1.0, status 1 means SUCCESS!
    const isCpcbSuccess = cpcbRes.ok && (
      cpcbStatus === 1 ||
      cpcbStatus === 100 ||
      cpcbStatus === 200 ||
      String(cpcbMsg).toLowerCase().includes('success')
    );

    let hint = '';
    if (!isCpcbSuccess) {
      if (cpcbStatus === 10) {
        hint = 'Status 10: Failed. Check that Station ID, Device ID, and Parameter keys (e.g. pm, so2) match your exact CPCB station registration.';
      } else if (cpcbStatus === 101) {
        hint = `Status 101: Industry ID is invalid or unrecognized by CPCB.`;
      } else if (cpcbStatus === 102) {
        hint = `Status 102: Station ID "${cleanStationId}" does not exist in CPCB records.`;
      } else if (cpcbStatus === 108) {
        hint = `Status 108: Device ID "${cleanDeviceId}" is invalid or not registered to station ${cleanStationId}.`;
      } else if (cpcbStatus === 109) {
        hint = 'Status 109: Payload not encrypted properly. Ensure Token ID and Public.pem match the registered credentials in CPCB ODAMS portal under "Industry Key Generation".';
      } else if (cpcbStatus === 110) {
        hint = 'Status 110: Invalid measurement unit. Use the Live page unit selector to switch between mg/m3, mg/Nm3, ug/m3, or ppm to match your registered CPCB unit.';
      } else if (cpcbStatus === 111) {
        hint = 'Status 111: Timestamp does not align with 15-minute timeframe.';
      } else if (cpcbStatus === 113) {
        hint = 'Status 113: Signature key is missing or rejected by CPCB.';
      } else {
        hint = `CPCB responded with status ${cpcbStatus}: ${cpcbMsg}`;
      }
    }

    return res.status(isCpcbSuccess ? 200 : 422).json({
      ok: isCpcbSuccess,
      status: isCpcbSuccess ? 200 : 422,
      statusText: isCpcbSuccess ? 'OK' : 'CPCB Validation Notice',
      cpcbStatus,
      cpcbMsg,
      region: process.env.VERCEL_REGION || 'bom1',
      pushedAt: Date.now(),
      durationMs: duration,
      apiUrl,
      stationId: cleanStationId,
      deviceId: cleanDeviceId,
      params: formattedParams.length || 1,
      signatureTimestamp: signatureDetails.timestamp,
      response: responseJson || responseText,
      rawResponseBody: responseText,
      payloadSent: cpcbStandardPayload,
      headersSent: {
        ...headers,
        signature: headers.signature.substring(0, 32) + '...',
        Signature: headers.Signature.substring(0, 32) + '...',
      },
      hint,
      error: isCpcbSuccess ? null : `CPCB returned status ${cpcbStatus}: ${cpcbMsg}`,
      message: isCpcbSuccess
        ? `Successfully transmitted data to CPCB (${formattedParams.length || 1} parameters)`
        : `CPCB server responded: ${cpcbMsg}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Internal transmission error: ' + err.message,
      pushedAt: Date.now(),
      durationMs: Date.now() - startTime,
    });
  }
};
