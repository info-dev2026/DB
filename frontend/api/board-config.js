/* ============================================================
   api/board-config.js
   Vercel Serverless Function & Cloud API for Board Configuration
   Direct PostgreSQL persistence for CPCB & SPCB credentials.
   Guarantees 24/7 cloud storage with zero dependency on Render state.
   ============================================================ */

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

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

function normalizePublicKey(pemString) {
  if (!pemString || typeof pemString !== 'string') return '';
  let clean = pemString.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.includes('-----BEGIN')) {
    clean = `-----BEGIN PUBLIC KEY-----\n${clean}\n-----END PUBLIC KEY-----`;
  }
  return clean;
}

module.exports = async (req, res) => {
  // Enable CORS for dashboard.saaphzone.com and local dev
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,PATCH,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const p = getPool();

  try {
    /* ------------------------------------------------------------
       GET: Fetch configurations
       ------------------------------------------------------------ */
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const siteId = req.query?.siteId || url.searchParams.get('siteId') || (req.url.match(/boards\/([^/?]+)/) || [])[1] || (req.url.match(/config\/([^/?]+)/) || [])[1];
      const fetchAll = req.query?.all || url.searchParams.get('all') === 'true';

      if (fetchAll) {
        const result = await p.query(
          'SELECT * FROM board_configs WHERE auto_push = true ORDER BY site_code ASC;'
        );
        return res.status(200).json({ ok: true, count: result.rows.length, configs: result.rows });
      }

      if (!siteId) {
        const result = await p.query('SELECT * FROM board_configs ORDER BY updated_at DESC LIMIT 50;');
        return res.status(200).json({ ok: true, configs: result.rows });
      }

      const cleanSite = siteId.trim();
      const result = await p.query(
        'SELECT * FROM board_configs WHERE site_code = $1 OR site_code = (SELECT site_code FROM sites WHERE id::text = $1 LIMIT 1);',
        [cleanSite]
      );

      const boards = result.rows.map((row) => ({
        id: row.id,
        siteCode: row.site_code,
        boardCode: row.board_code,
        boardName: row.board_name,
        apiUrl: row.api_url,
        stationId: row.station_id || '',
        deviceId: row.device_id || '',
        tokenId: row.token_id || '',
        publicKeyPem: row.public_key_pem || '',
        publicKeyFileName: row.public_key_file_name || '',
        payloadMode: row.payload_mode || 'standard',
        parameters: row.parameters || [],
        paramUnits: row.param_units || {},
        autoPush: row.auto_push !== false,
        intervalMinutes: row.interval_minutes || 15,
        lastPushedAt: row.last_pushed_at,
        lastPushStatus: row.last_push_status,
        lastPushMsg: row.last_push_msg,
      }));

      const cpcbConfig = boards.find((b) => b.boardCode === 'CPCB') || boards[0] || null;

      return res.status(200).json({
        ok: true,
        siteId: cleanSite,
        boards,
        config: cpcbConfig,
      });
    }

    /* ------------------------------------------------------------
       POST: Save / Update configuration in PostgreSQL
       ------------------------------------------------------------ */
    if (req.method === 'POST') {
      const url = new URL(req.url, 'http://localhost');
      const pathSiteId = (req.url.match(/boards\/([^/?]+)/) || [])[1] || (req.url.match(/config\/([^/?]+)/) || [])[1];
      const body = req.body || {};

      const rawSiteId = body.siteId || body.siteCode || req.query?.siteId || url.searchParams.get('siteId') || pathSiteId;
      if (!rawSiteId) {
        return res.status(400).json({ ok: false, error: 'siteId or siteCode is required to save credentials.' });
      }

      let cleanSiteCode = String(rawSiteId).trim();
      // If siteId was numeric DB id, resolve actual siteCode
      if (/^\d+$/.test(cleanSiteCode)) {
        const siteLookup = await p.query('SELECT site_code FROM sites WHERE id = $1 LIMIT 1;', [Number(cleanSiteCode)]);
        if (siteLookup.rows.length > 0) {
          cleanSiteCode = siteLookup.rows[0].site_code;
        }
      }

      const boardCode = (body.boardCode || body.board || 'CPCB').trim().toUpperCase();
      const boardName = body.boardName || (boardCode === 'CPCB' ? 'Central Pollution Control Board' : `${boardCode} State Pollution Board`);
      const apiUrl = body.apiUrl || 'https://cems.cpcb.gov.in/v1.0/industry/data';
      const stationId = (body.stationId || '').trim();
      const deviceId = (body.deviceId || '').trim();
      const tokenId = (body.tokenId || '').trim();
      const publicKeyPem = normalizePublicKey(body.publicKeyPem || '');
      const publicKeyFileName = body.publicKeyFileName || (publicKeyPem ? 'Public.pem' : '');
      const payloadMode = body.payloadMode || 'standard';
      const parameters = Array.isArray(body.parameters) ? body.parameters : [];
      const paramUnits = typeof body.paramUnits === 'object' && body.paramUnits !== null ? body.paramUnits : {};
      const autoPush = body.autoPush !== undefined ? Boolean(body.autoPush) : true;
      const intervalMinutes = Number(body.intervalMinutes) || 15;
      const fallbackSimulation = body.fallbackSimulation !== undefined ? Boolean(body.fallbackSimulation) : true;

      const upsertSql = `
        INSERT INTO board_configs (
          site_code, board_code, board_name, api_url,
          station_id, device_id, token_id, public_key_pem, public_key_file_name,
          payload_mode, parameters, param_units, auto_push, interval_minutes,
          fallback_simulation, updated_at
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14,
          $15, NOW()
        )
        ON CONFLICT (site_code, board_code)
        DO UPDATE SET
          board_name = EXCLUDED.board_name,
          api_url = EXCLUDED.api_url,
          station_id = EXCLUDED.station_id,
          device_id = EXCLUDED.device_id,
          token_id = EXCLUDED.token_id,
          public_key_pem = EXCLUDED.public_key_pem,
          public_key_file_name = EXCLUDED.public_key_file_name,
          payload_mode = EXCLUDED.payload_mode,
          parameters = EXCLUDED.parameters,
          param_units = EXCLUDED.param_units,
          auto_push = EXCLUDED.auto_push,
          interval_minutes = EXCLUDED.interval_minutes,
          fallback_simulation = EXCLUDED.fallback_simulation,
          updated_at = NOW()
        RETURNING *;
      `;

      // In case the table doesn't have unique constraint on (site_code, board_code), perform conditional check
      let row;
      try {
        const result = await p.query(upsertSql, [
          cleanSiteCode,
          boardCode,
          boardName,
          apiUrl,
          stationId,
          deviceId,
          tokenId,
          publicKeyPem,
          publicKeyFileName,
          payloadMode,
          JSON.stringify(parameters),
          JSON.stringify(paramUnits),
          autoPush,
          intervalMinutes,
          fallbackSimulation,
        ]);
        row = result.rows[0];
      } catch (upsertErr) {
        // Fallback: check if row exists manually
        const existing = await p.query(
          'SELECT id FROM board_configs WHERE site_code = $1 AND board_code = $2 LIMIT 1;',
          [cleanSiteCode, boardCode]
        );
        if (existing.rows.length > 0) {
          const updateResult = await p.query(
            `UPDATE board_configs SET
              board_name = $1, api_url = $2, station_id = $3, device_id = $4,
              token_id = $5, public_key_pem = $6, public_key_file_name = $7,
              payload_mode = $8, parameters = $9, param_units = $10,
              auto_push = $11, interval_minutes = $12, fallback_simulation = $13,
              updated_at = NOW()
            WHERE id = $14 RETURNING *;`,
            [
              boardName,
              apiUrl,
              stationId,
              deviceId,
              tokenId,
              publicKeyPem,
              publicKeyFileName,
              payloadMode,
              JSON.stringify(parameters),
              JSON.stringify(paramUnits),
              autoPush,
              intervalMinutes,
              fallbackSimulation,
              existing.rows[0].id,
            ]
          );
          row = updateResult.rows[0];
        } else {
          const insertResult = await p.query(
            `INSERT INTO board_configs (
              site_code, board_code, board_name, api_url,
              station_id, device_id, token_id, public_key_pem, public_key_file_name,
              payload_mode, parameters, param_units, auto_push, interval_minutes,
              fallback_simulation, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, $7, $8, $9,
              $10, $11, $12, $13, $14,
              $15, NOW(), NOW()
            ) RETURNING *;`,
            [
              cleanSiteCode,
              boardCode,
              boardName,
              apiUrl,
              stationId,
              deviceId,
              tokenId,
              publicKeyPem,
              publicKeyFileName,
              payloadMode,
              JSON.stringify(parameters),
              JSON.stringify(paramUnits),
              autoPush,
              intervalMinutes,
              fallbackSimulation,
            ]
          );
          row = insertResult.rows[0];
        }
      }

      return res.status(200).json({
        ok: true,
        message: `Credentials saved directly to 24/7 Cloud Database for ${cleanSiteCode} [${boardCode}]`,
        config: {
          id: row.id,
          siteCode: row.site_code,
          boardCode: row.board_code,
          stationId: row.station_id,
          deviceId: row.device_id,
          tokenId: row.token_id,
          hasPublicKeyPem: Boolean(row.public_key_pem),
          parameters: row.parameters,
          autoPush: row.auto_push,
          intervalMinutes: row.interval_minutes,
        },
      });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('board-config error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
