/* ============================================================
   routes/portal/reports.routes.js — Sequelize version
   Query: /reports/data?siteId=X&from=ISO&to=ISO
   ============================================================ */

const router = require('express').Router();
const { Reading, Site } = require('../../models');
const auth = require('../../middleware/apiKeyAuth');
const { Op } = require('sequelize');

router.get('/data', auth(), async (req, res, next) => {
  try {
    const { siteId, from, to } = req.query;
    if (!siteId || !from || !to) {
      return res.status(400).json({ error: 'siteId, from, to required' });
    }

    const site = await Site.findOne({ where: { siteCode: siteId } });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const rows = await Reading.findAll({
      where: {
        siteCode: siteId,
        ts: { [Op.between]: [new Date(from), new Date(to)] },
      },
      order: [['ts', 'ASC']],
    });

    res.json({
      siteId,
      from,
      to,
      count: rows.length,
      rows: rows.map((r) => ({
        pid: r.pid,
        param: r.param,
        value: Number(r.value),
        ts: r.ts,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;