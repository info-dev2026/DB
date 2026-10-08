/* ============================================================
   scripts/setup-cpcb-credentials.js
   Directly view, save, or test CPCB credentials in PostgreSQL.
   Saves credentials to 24/7 cloud database so autonomous transmissions
   hit CPCB even when your laptop and browser tab are closed.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

let Pool;
try {
  Pool = require('pg').Pool;
} catch (e) {
  try {
    Pool = require('../backend/node_modules/pg').Pool;
  } catch (e2) {
    Pool = require('./backend/node_modules/pg').Pool;
  }
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://saaphzone_user:2ojnbmErthu0g3WkAjIy0kG3C8x9us5l@dpg-dar1uc8473hc739hmh80-a.ohio-postgres.render.com/saaphzone';

function normalizePublicKey(pemString) {
  if (!pemString || typeof pemString !== 'string') return '';
  let clean = pemString.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.includes('-----BEGIN')) {
    clean = `-----BEGIN PUBLIC KEY-----\n${clean}\n-----END PUBLIC KEY-----`;
  }
  return clean;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      parsed[key] = val;
    }
  }
  return parsed;
}

function postToRegulatoryBoard(targetUrl, headers, postData, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(targetUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);

      const reqHeaders = {
        ...headers,
        Host: url.hostname,
        'Content-Length': Buffer.byteLength(bodyStr),
      };

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: reqHeaders,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      };

      const req = client.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: rawData,
            json,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Timeout after ${timeoutMs / 1000}s`));
      });
      req.on('error', (err) => reject(err));
      req.write(bodyStr);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function testLiveCpcbPush(apiUrl, stationId, deviceId, tokenId, publicKeyPem, lat = 28.116096, lng = 76.781141) {
  const normPem = normalizePublicKey(publicKeyPem);
  if (!normPem || !tokenId || !stationId || !deviceId) {
    return { ok: false, error: 'Missing required credentials for CPCB verification.' };
  }

  const now = new Date();
  const slotMs = 15 * 60 * 1000;
  const alignedMs = Math.floor(now.getTime() / slotMs) * slotMs;
  const alignedDate = new Date(alignedMs);
  const utc = alignedDate.getTime() + alignedDate.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  // CPCB ODAMS strictly requires 15-minute aligned timestamp with .000 ms
  const tsStr = `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())} ${pad(ist.getHours())}:${pad(ist.getMinutes())}:00.000`;

  const msg = `${tokenId}$*${tsStr}`;
  let signatureBase64 = '';
  try {
    signatureBase64 = crypto
      .publicEncrypt(
        {
          key: normPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(msg)
      )
      .toString('base64');
  } catch (err) {
    return { ok: false, error: 'RSA encryption failed with public key: ' + err.message };
  }

  const payload = {
    data: [
      {
        stationId: stationId.trim(),
        device_data: [
          {
            deviceId: deviceId.trim(),
            params: [
              {
                parameter: 'pm',
                value: 36.34,
                unit: 'mg/m³',
                timestamp: alignedMs,
                flag: 'U',
              },
            ],
          },
        ],
        latitude: parseFloat(lat) || 28.116096,
        longitude: parseFloat(lng) || 76.781141,
      },
    ],
  };

  const aesKey = crypto.createHash('sha256').update(tokenId.trim()).digest();
  const cipher = crypto.createCipheriv('aes-256-ecb', aesKey, null);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const headers = {
    'Content-Type': 'application/json',
    signature: signatureBase64,
    'X-Device-Id': deviceId.trim(),
  };

  try {
    const res = await postToRegulatoryBoard(apiUrl, headers, encrypted, 20000);
    const cpcbStatus = res.json && res.json.status !== undefined ? res.json.status : null;
    const cpcbMsg = res.json && res.json.msg ? res.json.msg : res.body;
    const isSuccess = res.ok && (cpcbStatus === 1 || cpcbStatus === 100 || cpcbStatus === 200 || String(cpcbMsg).toLowerCase().includes('success'));
    return { ok: isSuccess, status: cpcbStatus || res.status, msg: cpcbMsg, raw: res.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const args = parseArgs();
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  console.log('============================================================');
  console.log('  Saaphzone OCEMS - 24/7 CPCB Cloud Credential Manager');
  console.log('============================================================\n');

  try {
    // List existing configs
    if (args.list || Object.keys(args).length === 0) {
      const res = await pool.query('SELECT * FROM board_configs ORDER BY updated_at DESC;');
      console.log(`📋 Total Board Configurations in PostgreSQL: ${res.rows.length}\n`);

      if (res.rows.length === 0) {
        console.log('No configurations found yet in the cloud database.\n');
        console.log('To save credentials from command line, run:');
        console.log('  node scripts/setup-cpcb-credentials.js --site <SITE_CODE> --station <STATION_ID> --device <DEVICE_ID> --token <TOKEN_ID> --pem <PATH_TO_PEM>\n');
        console.log('Or save credentials in your web dashboard (Live Push -> Save Credentials).\n');
      } else {
        console.table(
          res.rows.map((r) => ({
            Site: r.site_code,
            Board: r.board_code,
            StationID: r.station_id,
            DeviceID: r.device_id,
            TokenID: r.token_id ? r.token_id.slice(0, 10) + '...' : '(none)',
            HasPem: Boolean(r.public_key_pem),
            AutoPush: r.auto_push,
            LastStatus: r.last_push_status || 'Never',
            LastPushed: r.last_pushed_at ? new Date(r.last_pushed_at).toLocaleString() : 'Never',
          }))
        );
      }

      await pool.end();
      return;
    }

    // Save or update credentials
    const siteCode = args.site || args.siteId || args.siteCode;
    if (!siteCode) {
      console.error('❌ Error: --site <SITE_CODE> is required to save credentials.');
      await pool.end();
      process.exit(1);
    }

    const stationId = (args.station || args.stationId || '').trim();
    const deviceId = (args.device || args.deviceId || '').trim();
    const tokenId = (args.token || args.tokenId || '').trim();

    let pemContent = '';
    let pemFileName = 'public.pem';
    if (args.pem) {
      const rawPemArg = String(args.pem).replace(/^["']|["']$/g, '').trim();
      if (fs.existsSync(rawPemArg)) {
        const stat = fs.statSync(rawPemArg);
        if (stat.isDirectory()) {
          const files = fs.readdirSync(rawPemArg);
          const found = files.find((f) => /^public\.pem$/i.test(f)) || files.find((f) => f.toLowerCase().endsWith('.pem'));
          if (found) {
            pemFileName = found;
            const fullPemPath = path.join(rawPemArg, found);
            console.log(`📁 Auto-detected PEM file in directory: ${fullPemPath}`);
            pemContent = fs.readFileSync(fullPemPath, 'utf8');
          } else {
            console.error(`❌ Error: Directory "${rawPemArg}" does not contain a .pem file (e.g. public.pem).`);
            await pool.end();
            process.exit(1);
          }
        } else {
          pemFileName = path.basename(rawPemArg);
          pemContent = fs.readFileSync(rawPemArg, 'utf8');
        }
      } else {
        pemContent = args.pem;
      }
    }

    const normPem = normalizePublicKey(pemContent);
    const boardCode = (args.board || 'CPCB').trim().toUpperCase();
    const boardName = boardCode === 'CPCB' ? 'Central Pollution Control Board' : `${boardCode} State Pollution Board`;
    const apiUrl = args.url || 'https://cems.cpcb.gov.in/v1.0/industry/data';

    // Verify site exists in sites table
    const siteCheck = await pool.query(
      'SELECT id, site_code, name, lat, lng FROM sites WHERE site_code = $1 OR id::text = $1 LIMIT 1;',
      [siteCode]
    );

    const actualSiteCode = siteCheck.rows.length > 0 ? siteCheck.rows[0].site_code : siteCode;
    const siteName = siteCheck.rows.length > 0 ? siteCheck.rows[0].name : siteCode;
    const siteLat = siteCheck.rows.length > 0 && siteCheck.rows[0].lat ? parseFloat(siteCheck.rows[0].lat) : 28.116096;
    const siteLng = siteCheck.rows.length > 0 && siteCheck.rows[0].lng ? parseFloat(siteCheck.rows[0].lng) : 76.781141;

    console.log(`Setting up credentials for: ${siteName} (${actualSiteCode})`);

    // Fetch existing params from DB to auto-populate if not passed
    let configuredParams = ['PM'];
    let configuredUnits = { PM: 'mg/m³' };
    try {
      const pRes = await pool.query('SELECT key, unit FROM params WHERE site_code = $1;', [actualSiteCode]);
      if (pRes.rows.length > 0) {
        configuredParams = pRes.rows.map((r) => r.key);
        configuredUnits = {};
        pRes.rows.forEach((r) => {
          configuredUnits[r.key] = r.unit || 'mg/m³';
        });
      }
    } catch (e) {}

    // Check existing
    const existing = await pool.query(
      'SELECT * FROM board_configs WHERE site_code = $1 AND board_code = $2 LIMIT 1;',
      [actualSiteCode, boardCode]
    );

    if (existing.rows.length > 0) {
      const prev = existing.rows[0];
      const newStation = stationId || prev.station_id || '';
      const newDevice = deviceId || prev.device_id || '';
      const newToken = tokenId || prev.token_id || '';
      const newPem = normPem || prev.public_key_pem || '';
      const newPemFile = pemFileName || prev.public_key_file_name || 'public.pem';

      await pool.query(
        `UPDATE board_configs SET
          board_name = $1, api_url = $2, station_id = $3, device_id = $4,
          token_id = $5, public_key_pem = $6, public_key_file_name = $7,
          parameters = $8, param_units = $9,
          auto_push = true, updated_at = NOW()
        WHERE id = $10;`,
        [boardName, apiUrl, newStation, newDevice, newToken, newPem, newPemFile, JSON.stringify(configuredParams), JSON.stringify(configuredUnits), prev.id]
      );
      console.log(`✅ [UPDATED] Credentials updated in PostgreSQL for ${actualSiteCode} [${boardCode}]!`);
    } else {
      await pool.query(
        `INSERT INTO board_configs (
          site_code, board_code, board_name, api_url,
          station_id, device_id, token_id, public_key_pem, public_key_file_name,
          payload_mode, parameters, param_units, auto_push, interval_minutes,
          fallback_simulation, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          'standard', $10, $11, true, 15,
          true, NOW(), NOW()
        );`,
        [actualSiteCode, boardCode, boardName, apiUrl, stationId, deviceId, tokenId, normPem, pemFileName, JSON.stringify(configuredParams), JSON.stringify(configuredUnits)]
      );
      console.log(`✅ [CREATED] Credentials saved in PostgreSQL for ${actualSiteCode} [${boardCode}]!`);
    }

    console.log('\n============================================================');
    console.log('  Credentials are now active in the 24/7 Cloud Database!');
    console.log('  Autonomous transmission will hit CPCB every 15 minutes.');
    console.log('  You can safely shut down your laptop and close the tab.');
    console.log('============================================================\n');

    // Run instant live verification push to CPCB
    console.log('📡 Running immediate verification test to CPCB portal...');
    const testResult = await testLiveCpcbPush(apiUrl, stationId, deviceId, tokenId, normPem, siteLat, siteLng);
    if (testResult.ok) {
      console.log(`🎉 [VERIFIED SUCCESS] CPCB server accepted live transmission! (Status: ${testResult.status}, Msg: ${testResult.msg})`);
      await pool.query(
        `UPDATE board_configs SET last_pushed_at = NOW(), last_push_status = 'OK (200)', last_push_msg = $1, updated_at = NOW() WHERE site_code = $2 AND board_code = $3;`,
        [testResult.msg, actualSiteCode, boardCode]
      ).catch(() => {});
    } else {
      console.warn(`⚠️ [VERIFICATION NOTICE] CPCB returned: status=${testResult.status || 'ERR'}, msg=${testResult.msg || testResult.error}`);
    }

    await pool.end();
  } catch (err) {
    console.error('❌ Database error:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
