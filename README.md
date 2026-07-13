# Saaphzone OCEMS — Backend & Real Data Guide

This package fixes the "fake data" problem and gives you the backend the
single HTML file cannot be, plus the portal's own core logic to edit directly.

## Why the portal showed fake data

The portal file (`saaphzone_ocems_v2.html`) had a built-in **simulator**
(`tick()`) that invented random readings every few seconds. A single HTML
file **cannot receive** a POST from your logger — browsers don't listen for
incoming HTTP; only servers do. So real data never had anywhere to arrive.

## What was fixed in the portal

1. **Data Source page** (Admin ▸ Data Source) with three modes:
   - **Simulation** — the old demo behaviour (default).
   - **Live** — polls your backend, no fake data generated.
   - **Off** — nothing auto-updates; values change only when pushed in.
2. **`ingestReadings(readings)`** — applies real readings to the app, re-grades
   them against the CPCB thresholds, updates charts, and saves. Exposed on
   `window` so you can call it from the console or your own script.
3. **Live polling** — in Live mode the portal does
   `GET {API_BASE}/readings?since=<ms>` every N seconds and ingests the result.
4. Console helpers: `window.saaphzoneConfig()` and
   `window.setDataMode('live', { apiBase, apiKey })`.

## The data flow (real data)

```
  Data logger / analyzers
        │  POST /api/ingest   (X-API-Key: <logger key>)
        ▼
  backend server.js  ──stores──►  readings.json (forever, on disk)
        ▲
        │  GET /api/readings?since=<ms>  (portal key)
        │
  Portal (Data Source ▸ Live)  ──ingestReadings()──►  dashboards/charts/alerts
```

## Run the backend

```bash
cd backend
npm install express cors
node server.js
```

On first run it prints a **logger key** and a **portal key** — this is what
"generate an API key" actually means (a secret minted by the server; the HTML
file never holds one). Then:

- In the portal: Admin ▸ Data Source ▸ set mode **Live**, API base
  `http://YOUR_HOST:8080/api`, paste the **portal key**, Save & apply.
- In your logger: POST to `/api/ingest` with the **logger key**
  (see `logger_push_example.js`).

## Files

- **server.js** — Express backend: `/api/ingest` (receive), `/api/readings`
  (serve), `/api/keys` (mint keys), `/api/health`. JSON-file storage so data
  persists forever; swap for PostgreSQL/MongoDB by replacing `loadJSON`/`saveJSON`.
- **logger_push_example.js** — sample of how your logger sends readings.
- **portal_core_logic.js** — the portal's own extracted functions (data model,
  CPCB grading engine, persistence, ingestion). Edit these to change behaviour,
  then paste back into the `<script>` block of the HTML (search by function name).

## Reading identity

Each reading targets one channel, identified either by:
- `siteId` + `param` (e.g. `"ESK-4417"` + `"PM"`), or
- `pid` — the unique per-industry Parameter ID (e.g. `"ESK-4417-PM"`).

`ts` (epoch ms) is optional; the server stamps it if missing.

## Changing any function directly

- **Front-end behaviour** (grading thresholds, colours, service logic, UI):
  edit inside `saaphzone_ocems_v2.html` — every function is named; search for it.
  `portal_core_logic.js` mirrors the important ones with comments so you can see
  them in isolation first.
- **Server behaviour** (storage, keys, validation, endpoints): edit `server.js`.
- **CPCB thresholds** live in `gradeParameter()`; **parameter limits** live in
  the `PARAMS` registry; **service packages/rates** live per-industry in each
  site's `catalogue`. All are plain objects you can change.

## Note on "store forever"

The portal alone stores data in the browser's localStorage — per-browser and
per-device, and clearable by the user. For durable, multi-device, permanent
storage use the backend (`readings.json`, or a real database). That's the only
way "forever" is truly guaranteed.
