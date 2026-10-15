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
    const { siteId, from, to, interval } = req.query;
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

    const intervalMinutes = [1, 5, 10, 15].includes(Number(interval))
      ? Number(interval)
      : (Number(interval) || 15);
    const intervalMs = intervalMinutes * 60 * 1000;

    let finalRows = [];
    if (rows.length > 0) {
      const bucketed = {};
      for (const r of rows) {
        const tsTime = new Date(r.ts).getTime();
        const bucketTs = Math.floor(tsTime / intervalMs) * intervalMs;
        const key = `${bucketTs}_${r.param}`;
        if (!bucketed[key]) {
          bucketed[key] = {
            pid: r.pid,
            param: r.param,
            sum: Number(r.value),
            count: 1,
            bucketTs: new Date(bucketTs).toISOString(),
          };
        } else {
          bucketed[key].sum += Number(r.value);
          bucketed[key].count += 1;
        }
      }

      finalRows = Object.values(bucketed)
        .map((b) => ({
          pid: b.pid,
          param: b.param,
          value: Number((b.sum / b.count).toFixed(2)),
          ts: b.bucketTs,
        }))
        .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    }

    res.json({
      siteId,
      from,
      to,
      interval: intervalMinutes,
      count: finalRows.length,
      rows: finalRows,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;