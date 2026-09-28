/* ============================================================
   routes/datalogger.routes.js — Sequelize version

   POST /api/datalogger/readings
   Headers: x-device-key: <logger key>
   Body: { readings: [{ siteId?, param, value, ts? }] }

   - If the device uses its own per-site logger key,
     req.siteCode is set and used automatically.
   - If the device uses the global DEVICE_API_KEY,
     siteId must be provided in the body (legacy mode).
   ============================================================ */

const router = require('express').Router();
const { Op } = require('sequelize');
const { Site, Param, Reading, Alert, sequelize } = require('../models');
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

router.post('/readings', deviceAuth, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const arr = Array.isArray(req.body.readings) ? req.body.readings : [];
    if (!arr.length) {
      await t.rollback();
      return res.status(400).json({ error: 'No readings provided' });
    }

    /* ---------- Determine the target site(s) ---------- */
    // If the device authenticated with a per-site logger key,
    // force every reading to that site (ignore body siteId).
    const forcedSiteCode = req.siteCode || null;

    const siteCodes = forcedSiteCode
      ? [forcedSiteCode]
      : [...new Set(arr.map((r) => r.siteId).filter(Boolean))];

    const sites = await Site.findAll({
      where: { siteCode: { [Op.in]: siteCodes } },
      include: [{ model: Param, as: 'params' }],
      transaction: t,
    });

    const siteMap = new Map(sites.map((s) => [s.siteCode, s]));

    const touchedSiteCodes = new Set();
    let applied = 0;

    for (const r of arr) {
      const effectiveSiteId = forcedSiteCode || r.siteId;
      const site = siteMap.get(effectiveSiteId);
      if (!site) continue;

      const param = site.params.find((p) => p.key === r.param);
      if (!param) continue;

      const def = PARAMS[param.key] || {};
      const prevSignal = param.signal;

      /* ---------- Apply reading to param ---------- */
      const newValue = Number(r.value);
      const history = Array.isArray(param.history) ? [...param.history] : [];
      history.push(newValue);
      if (history.length > 24) history.shift();

      const over = isOverLimit({ ...param.toJSON(), value: newValue }, def);
      const nextExcStreak = over
        ? (param.excStreak || 0) + 1
        : Math.max(0, (param.excStreak || 0) - 1);

      const updatedParamFields = {
        value: newValue,
        phVal: def.ph ? newValue : param.phVal,
        history,
        excStreak: nextExcStreak,
        yToday: over ? (param.yToday || 0) + 1 : param.yToday || 0,
        y30: over ? (param.y30 || 0) + 1 : param.y30 || 0,
        connHrs: 0,
        connFailHrsToday: 0,
      };

      const nextSignal = gradeParameter({ ...param.toJSON(), ...updatedParamFields });
      updatedParamFields.signal = nextSignal;

      await param.update(updatedParamFields, { transaction: t });

      /* ---------- Persist reading ---------- */
      await Reading.create(
        {
          siteCode: site.siteCode,
          pid: param.pid,
          param: param.key,
          value: newValue,
          ts: r.ts ? new Date(r.ts) : new Date(),
        },
        { transaction: t }
      );

      /* ---------- Alert if signal worsened ---------- */
      if (
        nextSignal !== prevSignal &&
        ['yellow', 'orange', 'red', 'purple'].includes(nextSignal)
      ) {
        const alert = await Alert.create(
          {
            siteCode: site.siteCode,
            siteName: site.name,
            param: param.key,
            level: nextSignal,
            reason: triggerReason({ ...param.toJSON(), ...updatedParamFields }),
            ts: new Date(),
          },
          { transaction: t }
        );

        const alertJSON = {
          _id: String(alert.id),
          siteId: site.siteCode,
          site: site.name,
          param: param.key,
          level: nextSignal,
          reason: alert.reason,
          acknowledged: false,
          ts: alert.ts,
        };

        broadcast('alert:new', alertJSON);
        toSite(site.siteCode, 'alert:new', alertJSON);

        logger.warn(
          `⚠️  ALERT [${nextSignal}] ${site.siteCode} · ${param.key} = ${newValue}`
        );
      }

      touchedSiteCodes.add(site.siteCode);
      applied++;
    }

    /* ---------- Update touched sites ---------- */
    for (const code of touchedSiteCodes) {
      const site = siteMap.get(code);
      const freshParams = await Param.findAll({
        where: { siteCode: code },
        transaction: t,
      });

      const paramJSON = freshParams.map((p) => {
        const plain = p.toJSON();
        return {
          ...plain,
          name: plain.name || plain.key,
        };
      });
      const newSignal = rollup(paramJSON, 'green', site.enabled);

      await site.update(
        {
          lastSeenAt: new Date(),
          connectivity: 'live',
          running: true,
          lastData: 'just now',
          signal: newSignal,
        },
        { transaction: t }
      );

      broadcast('site:update', {
        siteId: site.siteCode,
        signal: newSignal,
        params: paramJSON,
      });
      toSite(site.siteCode, 'site:update', {
        siteId: site.siteCode,
        signal: newSignal,
        params: paramJSON,
      });
    }

    await t.commit();
    res.json({ ok: true, applied });
  } catch (e) {
    await t.rollback();
    next(e);
  }
});

/* GET /api/datalogger/ping */
router.get('/ping', (_, res) => res.json({ ok: true, ts: Date.now() }));

module.exports = router;