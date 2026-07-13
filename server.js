/* =============================================================
   Saaphzone OCEMS — Backend reference server
   -------------------------------------------------------------
   This is the piece the single-file portal cannot be: a server
   that (a) RECEIVES readings pushed by your data logger, and
   (b) SERVES them to the portal via GET /readings.

   The portal (Data Source ▸ Live) polls:
       GET  {API_BASE}/readings?since=<ms>
   Your logger pushes with:
       POST {API_BASE}/ingest      (header: X-API-Key: <logger key>)

   Run:
       npm install express cors
       node server.js
   Then in the portal set API base = http://YOUR_HOST:8080/api
   -------------------------------------------------------------
   Storage here is a simple JSON file (readings.json) so data
   persists "forever" on disk. Swap the load/save functions for
   PostgreSQL / MongoDB when you scale — the rest stays the same.
   ============================================================= */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const crypto  = require('crypto');
const path    = require('path');

const PORT      = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'readings.json');
const KEY_FILE  = path.join(__dirname, 'apikeys.json');

/* ---------- tiny JSON persistence (swap for a real DB later) ---------- */
function loadJSON(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, obj){
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// readings: array of { siteId, param, pid, value, ts }
let READINGS = loadJSON(DATA_FILE, []);
// api keys: { "<key>": { label, role: "logger"|"portal", createdAt } }
let KEYS     = loadJSON(KEY_FILE, {});

/* ---------- API KEY generation ----------
   THIS is what "generate an API key" actually means: a random
   secret minted by the server and stored here. The portal file
   itself never holds or generates one.                         */
function generateApiKey(label, role){
  const key = 'sz_' + role + '_' + crypto.randomBytes(24).toString('hex');
  KEYS[key] = { label: label || role, role: role || 'logger', createdAt: Date.now() };
  saveJSON(KEY_FILE, KEYS);
  return key;
}
// On first run, mint a logger key + a portal key and print them.
if (Object.keys(KEYS).length === 0){
  const loggerKey = generateApiKey('default-logger', 'logger');
  const portalKey = generateApiKey('default-portal', 'portal');
  console.log('\n=== NEW API KEYS (save these) ===');
  console.log('Logger key (put in your data logger POSTs):', loggerKey);
  console.log('Portal key (paste into Data Source ▸ API key):', portalKey);
  console.log('=================================\n');
}

function checkKey(role){
  return (req, res, next) => {
    const key = req.get('X-API-Key') ||
                (req.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    const rec = KEYS[key];
    if (!rec || (role && rec.role !== role)){
      return res.status(401).json({ error: 'invalid or missing API key' });
    }
    req.apiKey = rec;
    next();
  };
}

const app = express();
app.use(cors());                 // let the portal (any origin) read
app.use(express.json({ limit: '2mb' }));

/* ---------- INGEST: your data logger pushes here ----------
   POST /api/ingest
   Header: X-API-Key: <logger key>
   Body: { "readings": [ { siteId, param, value, ts? }, ... ] }
   or a single: { siteId, param, value }                       */
app.post('/api/ingest', checkKey('logger'), (req, res) => {
  let batch = req.body.readings || (Array.isArray(req.body) ? req.body : [req.body]);
  if (!Array.isArray(batch)) return res.status(400).json({ error: 'expected readings[]' });
  let added = 0;
  for (const r of batch){
    if (r.value == null || (!r.pid && !(r.siteId && r.param))) continue;
    READINGS.push({
      siteId: r.siteId || null,
      param:  r.param  || null,
      pid:    r.pid    || null,
      value:  Number(r.value),
      ts:     r.ts || Date.now()
    });
    added++;
  }
  // keep last 500k readings on disk; trim older
  if (READINGS.length > 500000) READINGS = READINGS.slice(-500000);
  saveJSON(DATA_FILE, READINGS);
  res.json({ ok: true, added });
});

/* ---------- READINGS: the portal polls here ----------
   GET /api/readings?since=<ms>
   Returns readings newer than <since>. Portal identifies each
   channel by siteId+param or pid.                              */
app.get('/api/readings', checkKey('portal'), (req, res) => {
  const since = Number(req.query.since || 0);
  const out = READINGS.filter(r => r.ts > since);
  res.json({ readings: out, serverTime: Date.now() });
});

/* ---------- ADMIN: mint a new key ----------
   POST /api/keys  { label, role }   (protect this in production!) */
app.post('/api/keys', (req, res) => {
  const { label, role } = req.body || {};
  if (!['logger','portal'].includes(role)) return res.status(400).json({ error: 'role must be logger|portal' });
  const key = generateApiKey(label, role);
  res.json({ key, label, role });
});

/* ---------- health ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true, readings: READINGS.length }));

app.listen(PORT, () => {
  console.log('Saaphzone OCEMS backend running on http://localhost:' + PORT);
  console.log('  POST /api/ingest    (logger key) — push readings');
  console.log('  GET  /api/readings  (portal key) — portal polls this');
  console.log('  POST /api/keys      — mint a new API key');
});
