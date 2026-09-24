const router = require('express').Router();
const Reading = require('../../models/Reading');
const auth = require('../../middleware/auth');

/* GET /api/portal/reports/data?siteId=&from=&to= */
router.get('/data', auth(), async (req, res, next) => {
  try {
    const { siteId, from, to } = req.query;
    if (!siteId || !from || !to) {
      return res.status(400).json({ error: 'siteId, from, to required' });
    }

    const readings = await Reading.find({
      siteId,
      ts: { $gte: new Date(Number(from)), $lte: new Date(Number(to)) },
    })
      .sort({ ts: 1 })
      .limit(10000);

    res.json({ readings });
  } catch (e) {
    next(e);
  }
});

module.exports = router;