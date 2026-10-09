/* ============================================================
   api/datalogger.js
   Vercel Serverless Function & Cloud API for Live Telemetry Ingest
   Direct PostgreSQL persistence for SCADA, ModScan, and Dataloggers.
   Matches readings specifically by Parameter ID (PID) to eliminate cross-talk.
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-device-key, x-api-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const p = getPool();

  try {
    // Health check / ping
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      if (url.searchParams.get('ping') === 'true' || req.url.includes('/ping')) {
        return res.status(200).json({ ok: true, ts: Date.now() });
      }

      const siteId = req.query?.siteId || url.searchParams.get('siteId');
      if (siteId) {
        const paramsRes = await p.query(
          'SELECT pid, key, name, unit, limit, value, signal FROM params WHERE site_code ILIKE $1 ORDER BY pid ASC;',
          [siteId.trim()]
        );
        return res.status(200).json({ ok: true, siteCode: siteId, parameters: paramsRes.rows });
      }

      return res.status(200).json({ ok: true, message: 'Datalogger API online' });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const siteIdFromRoot = body.siteId || body.siteCode || body.site || null;

      let readingsList = [];
      if (Array.isArray(body)) {
        readingsList = body;
      } else if (Array.isArray(body.readings)) {
        readingsList = body.readings;
      } else if (body.pid && (body.value !== undefined || body.val !== undefined)) {
        readingsList = [body];
      }

      if (!readingsList.length) {
        return res.status(400).json({ ok: false, error: 'No readings provided' });
      }

      let applied = 0;
      const diverted = [];
      const skipped = [];

      for (const r of readingsList) {
        const targetSite = (r.siteId || r.siteCode || siteIdFromRoot || '').trim();
        const targetPid = String(r.pid || r.paramId || r.parameterId || r.param || '').trim();
        const rawVal = r.value !== undefined ? r.value : r.val;

        if (rawVal === undefined || rawVal === null || isNaN(Number(rawVal))) {
          skipped.push({ pid: targetPid, reason: 'Invalid or missing numeric value' });
          continue;
        }

        const numVal = Math.round(Number(rawVal) * 100) / 100;
        const ts = r.ts ? new Date(r.ts) : new Date();

        // 1. Look up parameter by exact or normalized PID
        const cleanPid = targetPid.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const findQuery = targetSite
          ? `SELECT id, site_code, pid, key, limit, history FROM params WHERE site_code ILIKE $1 AND (pid ILIKE $2 OR UPPER(REPLACE(pid, '-', '')) = $3) LIMIT 1;`
          : `SELECT id, site_code, pid, key, limit, history FROM params WHERE pid ILIKE $1 OR UPPER(REPLACE(pid, '-', '')) = $2 LIMIT 1;`;
        const findParams = targetSite ? [targetSite, targetPid, cleanPid] : [targetPid, cleanPid];

        const matchRes = await p.query(findQuery, findParams);
        if (!matchRes.rows.length) {
          skipped.push({ pid: targetPid, siteId: targetSite, reason: 'Unmatched Parameter ID' });
          continue;
        }

        const paramRow = matchRes.rows[0];
        const siteCode = paramRow.site_code;

        // 2. Update params row
        const existingHist = Array.isArray(paramRow.history) ? paramRow.history : [];
        const nextHist = [...existingHist, numVal].slice(-24);
        const limitVal = parseFloat(paramRow.limit) || 100;
        const signal = numVal > limitVal ? 'red' : 'green';

        await p.query(
          `UPDATE params SET value = $1, signal = $2, history = $3, updated_at = NOW() WHERE id = $4;`,
          [numVal, signal, JSON.stringify(nextHist), paramRow.id]
        );

        // 3. Insert record into readings table
        await p.query(
          `INSERT INTO readings (site_code, pid, param, value, ts) VALUES ($1, $2, $3, $4, $5);`,
          [siteCode, paramRow.pid, paramRow.key, numVal, ts]
        );

        // 4. Update parent site
        await p.query(
          `UPDATE sites SET last_seen_at = NOW(), connectivity = 'live', last_data = 'just now' WHERE site_code = $1;`,
          [siteCode]
        );

        applied++;
        diverted.push({
          siteCode,
          pid: paramRow.pid,
          key: paramRow.key,
          value: numVal,
          signal,
        });
      }

      return res.status(200).json({
        ok: true,
        applied,
        divertedCount: applied,
        diverted,
        skipped,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[datalogger API error]:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
