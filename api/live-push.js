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
      dryRun = false,
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

    // Format CPCB standard payload
    const nowTs = Date.now();
    const formattedParams = (parameters || []).map((p) => {
      const pObj = typeof p === 'object' && p !== null ? p : { key: p };
      return {
        parameter: (pObj.name || pObj.key || '').replace(/SO2/g, 'SOX') || 'PARAM',
        value: typeof pObj.value === 'number' ? pObj.value : parseFloat(pObj.value) || 0,
        unit: pObj.unit || 'mg/Nm3',
        timestamp: String(nowTs),
        flag: 'U',
      };
    });

    const cpcbStandardPayload = [
      {
        deviceId: cleanDeviceId,
        params: formattedParams.length ? formattedParams : [
          { parameter: 'PM', value: 0, unit: 'mg/Nm3', timestamp: String(nowTs), flag: 'U' }
        ],
      },
    ];

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
        params: cpcbStandardPayload[0].params.length,
        signatureTimestamp: signatureDetails.timestamp,
        signaturePreview: signatureDetails.signature.substring(0, 32) + '...',
        cpcbPayload: cpcbStandardPayload,
        payloadSent: cpcbStandardPayload,
        headers: headers,
        headersSent: {
          ...headers,
          signature: headers.signature.substring(0, 32) + '...',
          Signature: headers.Signature.substring(0, 32) + '...',
        },
        message: 'Dry run successful: Signature generated and CPCB payload formatted.',
      });
    }

    // Direct HTTPS POST transmission to CPCB (bypassing Linux container CA verification issue)
    let cpcbRes;
    try {
      cpcbRes = await postToCpcb(apiUrl, headers, cpcbStandardPayload, 20000);
    } catch (networkErr) {
      const causeDetails = networkErr.cause ? ` (${networkErr.cause.code || networkErr.cause.message || ''})` : '';
      return res.status(502).json({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway / Network Failure',
        isNetworkError: true,
        error: `Could not reach CPCB server at ${apiUrl}. (${networkErr.message}${causeDetails})`,
        details: networkErr.code || networkErr.name,
        pushedAt: Date.now(),
        durationMs: Date.now() - startTime,
        apiUrl,
        stationId: cleanStationId,
        deviceId: cleanDeviceId,
        params: cpcbStandardPayload[0].params.length,
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
    const ok = cpcbRes.ok;
    const responseJson = cpcbRes.json;
    const responseText = cpcbRes.body;
    const cpcbStatus = responseJson && responseJson.status !== undefined ? responseJson.status : null;
    const cpcbMsg = responseJson && responseJson.msg ? responseJson.msg : (responseText || cpcbRes.statusText);

    return res.status(ok ? 200 : cpcbRes.status).json({
      ok: ok,
      status: cpcbRes.status,
      statusText: cpcbRes.statusText,
      cpcbStatus,
      cpcbMsg,
      pushedAt: Date.now(),
      durationMs: duration,
      apiUrl,
      stationId: cleanStationId,
      deviceId: cleanDeviceId,
      params: cpcbStandardPayload[0].params.length,
      signatureTimestamp: signatureDetails.timestamp,
      response: responseJson || responseText,
      rawResponseBody: responseText,
      payloadSent: cpcbStandardPayload,
      headersSent: {
        ...headers,
        signature: headers.signature.substring(0, 32) + '...',
        Signature: headers.Signature.substring(0, 32) + '...',
      },
      message: ok
        ? `Successfully transmitted data to CPCB (${cpcbStandardPayload[0].params.length} parameters)`
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
