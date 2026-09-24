const router = require('express').Router();
const ServiceContract = require('../../models/ServiceContract');
const Site = require('../../models/Site');
const auth = require('../../middleware/auth');

/* GET /api/portal/services — list contracts */
router.get('/', auth(), async (req, res, next) => {
  try {
    const filter =
      req.user.role === 'industry' ? { siteId: req.user.siteId } : {};
    const list = await ServiceContract.find(filter).sort({ expiry: 1 });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

/* POST /api/portal/services/renew */
router.post('/renew', auth(), async (req, res, next) => {
  try {
    const { siteId, key, package: pkgId, months, price, from } = req.body;

    const site = await Site.findOne({ id: siteId });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const group = key.split('|')[0];
    const tier =
      (site.catalogue?.[group]?.tiers || []).find((t) => t.id === pkgId) ||
      null;

    const existing = await ServiceContract.findOne({ siteId, key });
    const base =
      from === 'expiry' &&
      existing?.expiry &&
      new Date(existing.expiry) > new Date()
        ? new Date(existing.expiry)
        : new Date();

    const addMonths = tier?.months || months || 12;
    base.setMonth(base.getMonth() + addMonths);

    const updated = await ServiceContract.findOneAndUpdate(
      { siteId, key },
      {
        $set: {
          start: new Date(),
          expiry: base,
          package: pkgId,
          suspended: false,
        },
        $push: {
          history: {
            package: tier?.label || pkgId,
            months: addMonths,
            price: tier?.price || price || 0,
            at: new Date(),
            till: base,
            by: req.user.name || 'industry',
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;