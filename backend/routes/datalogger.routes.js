/* ============================================================
   routes/datalogger.routes.js — Sequelize & Telemetry Diverter

   Endpoints for ModScan, Modbus Master, PLC, & SCADA Dataloggers:
   - POST /api/datalogger/readings  (Generic parameter data ingest)
   - POST /api/datalogger/divert    (Verbose parameter divert endpoint)
   - GET  /api/datalogger/schema/:id(List of parameter IDs for Modscan)
   - GET  /api/datalogger/ping      (Health check)

   Headers: x-device-key: <logger key> or x-api-key: <portal key>
   ============================================================ */

const router = require('express').Router();
const deviceAuth = require('../middleware/deviceAuth');
const { Site, Param } = require('../models');
const { divertTelemetry } = require('../services/telemetryDiverter');

/**
 * POST /api/datalogger/readings
 * Universal ingest handler for live parameter telemetry.
 * Automatically recognizes single reading, arrays, Modscan register maps,
 * or standard { readings: [...] } envelopes.
 */
router.post('/readings', deviceAuth, async (req, res, next) => {
  try {
    const forcedSiteCode = req.siteCode || null;

    const result = await divertTelemetry({
      payload: req.body,
      forcedSiteCode,
    });

    if (!result.ok && result.divertedCount === 0) {
      return res.status(400).json(result);
    }

    res.json({
      ok: true,
      applied: result.applied,
      diverted: result.diverted,
      skipped: result.skipped,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/datalogger/divert
 * Explicit verbose telemetry diversion endpoint designed for Modscan/PLC bridges.
 */
router.post('/divert', deviceAuth, async (req, res, next) => {
  try {
    const forcedSiteCode = req.siteCode || null;

    const result = await divertTelemetry({
      payload: req.body,
      forcedSiteCode,
    });

    res.json({
      ok: result.ok,
      message: `Successfully diverted ${result.applied} parameter(s) to live dashboard`,
      ...result,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/datalogger/parameters
 * Returns all active Parameter IDs (PIDs) across all sites
 * without requiring any siteId input.
 */
router.get('/parameters', deviceAuth, async (req, res, next) => {
  try {
    const params = await Param.findAll({
      attributes: ['id', 'pid', 'key', 'name', 'unit', 'limit', 'value', 'signal', 'siteCode'],
      order: [['pid', 'ASC']],
    });

    res.json({
      ok: true,
      count: params.length,
      parameters: params.map((p) => ({
        pid: p.pid,
        key: p.key,
        name: p.name || p.key,
        unit: p.unit,
        limit: p.limit,
        currentValue: p.value,
        signal: p.signal,
        siteCode: p.siteCode,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/datalogger/schema/:siteId
 * Returns the exact list of configured Parameter IDs (PIDs) for a site
 * so the engineer can configure ModScan registers / tags with zero friction.
 */
router.get('/schema/:siteId', deviceAuth, async (req, res, next) => {
  try {
    const siteCode = req.siteCode || req.params.siteId;
    const site = await Site.findOne({
      where: { siteCode },
      include: [{ model: Param, as: 'params' }],
    });

    if (!site) {
      return res.status(404).json({ error: `Site "${siteCode}" not found` });
    }

    res.json({
      siteCode: site.siteCode,
      siteName: site.name,
      parameters: (site.params || []).map((p) => ({
        pid: p.pid,
        key: p.key,
        name: p.name || p.key,
        unit: p.unit,
        limit: p.limit,
        currentValue: p.value,
        signal: p.signal,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/* GET /api/datalogger/ping */
router.get('/ping', (_, res) => res.json({ ok: true, ts: Date.now() }));

module.exports = router;