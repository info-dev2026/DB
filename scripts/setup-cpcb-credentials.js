/* ============================================================
   scripts/setup-cpcb-credentials.js
   Directly view, save, or test CPCB credentials in PostgreSQL.
   Saves credentials to 24/7 cloud database so autonomous transmissions
   hit CPCB even when your laptop and browser tab are closed.
   ============================================================ */

const fs = require('fs');
const path = require('path');

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
            TokenID: r.token_id ? (r.token_id.slice(0, 10) + '...') : '(none)',
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
    if (args.pem) {
      if (fs.existsSync(args.pem)) {
        pemContent = fs.readFileSync(args.pem, 'utf8');
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
      'SELECT id, site_code, name FROM sites WHERE site_code = $1 OR id::text = $1 LIMIT 1;',
      [siteCode]
    );

    const actualSiteCode = siteCheck.rows.length > 0 ? siteCheck.rows[0].site_code : siteCode;
    const siteName = siteCheck.rows.length > 0 ? siteCheck.rows[0].name : siteCode;

    console.log(`Setting up credentials for: ${siteName} (${actualSiteCode})`);

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

      await pool.query(
        `UPDATE board_configs SET
          board_name = $1, api_url = $2, station_id = $3, device_id = $4,
          token_id = $5, public_key_pem = $6, auto_push = true, updated_at = NOW()
        WHERE id = $7;`,
        [boardName, apiUrl, newStation, newDevice, newToken, newPem, prev.id]
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
          $5, $6, $7, $8, 'Public.pem',
          'standard', '["PM"]'::jsonb, '{"PM":"mg/m³"}'::jsonb, true, 15,
          true, NOW(), NOW()
        );`,
        [actualSiteCode, boardCode, boardName, apiUrl, stationId, deviceId, tokenId, normPem]
      );
      console.log(`✅ [CREATED] Credentials saved in PostgreSQL for ${actualSiteCode} [${boardCode}]!`);
    }

    console.log('\n============================================================');
    console.log('  Credentials are now active in the 24/7 Cloud Database!');
    console.log('  Autonomous transmission will hit CPCB every 15 minutes.');
    console.log('  You can now safely shut down your laptop and close the tab.');
    console.log('============================================================\n');

    await pool.end();
  } catch (err) {
    console.error('❌ Database error:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
