const router = require('express').Router();
const Site = require('../models/Site');
const Reading = require('../models/Reading');
const Alert = require('../models/Alert');
const deviceAuth = require('../middleware/deviceAuth');
const logger = require('../utils/logger');
const PARAMS = require('../utils/paramRegistry');
const {
  gradeParameter,
  rollup,
  triggerReason,
  isOverLimit,
} = require('../services/cpcbEngine');
const { broadcast, toSite } = require('../services/socketService');

/* ============================================================
   POST /api/datalogger/readings
   Headers: x-device-key: <DEVICE_API_KEY>
   Body: {
     "readings": [
       { "siteId": "ESK-4417", "param": "PM", "value": 42.7, "ts": 1726838400000 },
       { "siteId": "ESK-4417", "param": "SO2", "value": 180.4 }
     ]
   }
   ============================================================ */
router.post('/readings', deviceAuth, async (req, res, next) => {
  try {
    const arr = Array.isArray(req.body.readings) ? req.body.readings : [];
    if (!arr.length) {
      return res.status(400).json({ error: 'No readings provided' });
    }

    /* Group by site for efficient updates */
    const siteIds = [...new Set(arr.map((r) => r.siteId).filter(Boolean))];
    const sites = await Site.find({ id: { $in: siteIds } });

    const touched = {};
    let applied = 0;

    for (const r of arr) {
      const site = sites.find((s) => s.id === r.siteId);
      if (!site) continue;

      const p = site.params.find((x) => x.key === r.param);
      if (!p) continue;

      const def = PARAMS[p.key] || {};
      const prevSignal = p.signal;

      /* ---- Apply the reading ---- */
      p.value = +r.value;
      if (def.ph) p.phVal = +r.value;
      p.history.push(p.value);
      if (p.history.length > 24) p.history.shift();

      /* ---- Counter updates ---- */
      const over = isOverLimit(p, def);
      if (over) {
        p.excStreak = (p.excStreak || 0) + 1;
        p.yToday = (p.yToday || 0) + 1;
        p.y30 = (p.y30 || 0) + 1;
      } else {
        p.excStreak = Math.max(0, (p.excStreak || 0) - 1);
      }
      p.connHrs = 0;
      p.connFailHrsToday = 0;

      /* ---- Re-grade ---- */
      p.signal = gradeParameter(p);

      /* ---- Persist reading ---- */
      await Reading.create({
        siteId: site.id,
        pid: p.pid,
        param: p.key,
        value: p.value,
        ts: r.ts ? new Date(r.ts) : new Date(),
      });

      /* ---- If signal just worsened, create an alert + push ---- */
      if (
        p.signal !== prevSignal &&
        ['yellow', 'orange', 'red', 'purple'].includes(p.signal)
      ) {
        const alert = await Alert.create({
          siteId: site.id,
          site: site.name,
          param: p.key,
          level: p.signal,
          reason: triggerReason(p),
        });

        broadcast('alert:new', alert.toObject());
        toSite(site.id, 'alert:new', alert.toObject());

        logger.warn(`⚠️  ALERT [${p.signal}] ${site.id} · ${p.key} = ${p.value}`);
      }

      touched[site.id] = site;
      applied++;
    }

    /* ---- Save touched sites + emit site:update ---- */
    for (const site of Object.values(touched)) {
      site.lastSeenAt = new Date();
      site.connectivity = 'live';
      site.running = true;
      site.lastData = 'just now';
      site.signal = rollup(site.params, 'green', site.enabled);
      await site.save();

      broadcast('site:update', {
        siteId: site.id,
        signal: site.signal,
        params: site.params,
      });
      toSite(site.id, 'site:update', {
        siteId: site.id,
        signal: site.signal,
        params: site.params,
      });
    }

    res.json({ ok: true, applied });
  } catch (e) {
    next(e);
  }
});

/* GET /api/datalogger/ping — quick reachability test for hardware */
router.get('/ping', (_, res) => res.json({ ok: true, ts: Date.now() }));

module.exports = router;