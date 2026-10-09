/* ============================================================
   api/next-param-id.js
   Vercel Serverless Function: Auto allocate globally unique numeric PIDs
   Guarantees all parameter IDs are digits only and collision-free.
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const p = getPool();

  try {
    const url = new URL(req.url, 'http://localhost');
    const countRaw = req.query?.count || url.searchParams.get('count') || '1';
    const count = Math.max(1, parseInt(countRaw, 10) || 1);

    const result = await p.query('SELECT pid FROM params;');
    const used = new Set();

    for (const row of result.rows) {
      if (row && row.pid) {
        const s = String(row.pid).trim();
        if (/^\d+$/.test(s)) {
          used.add(parseInt(s, 10));
        }
      }
    }

    const pids = [];
    let candidate = 1001;

    while (pids.length < count) {
      while (used.has(candidate)) {
        candidate++;
      }
      pids.push(String(candidate));
      used.add(candidate);
      candidate++;
    }

    return res.status(200).json({
      ok: true,
      count: pids.length,
      pids,
      pid: pids[0],
    });
  } catch (err) {
    console.error('next-param-id error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

module.exports.config = {
  maxDuration: 30,
};
