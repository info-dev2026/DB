/* ============================================================
   routes/portal/services.routes.js — Sequelize version
   ============================================================ */

const router = require('express').Router();
const { ServiceContract, ServiceHistory, sequelize } = require('../../models');
const auth = require('../../middleware/auth');

function toContractJSON(c) {
  if (!c) return null;
  const p = c.toJSON ? c.toJSON() : c;
  return {
    _id: String(p.id),
    siteId: p.siteCode,
    key: p.key,
    start: p.start,
    expiry: p.expiry,
    package: p.package,
    suspended: p.suspended,
    history: (p.history || []).map((h) => ({
      _id: String(h.id),
      package: h.package,
      months: h.months,
      price: h.price != null ? Number(h.price) : 0,
      at: h.at,
      till: h.till,
      by: h.by,
    })),
  };
}

/* GET /api/portal/services */
router.get('/', auth(), async (req, res, next) => {
  try {
    const where = req.user.role === 'industry' ? { siteCode: req.user.siteId } : {};
    const rows = await ServiceContract.findAll({
      where,
      include: [{ model: ServiceHistory, as: 'history' }],
    });
    res.json(rows.map(toContractJSON));
  } catch (e) {
    next(e);
  }
});

/* POST /api/portal/services/renew */
router.post('/renew', auth(['admin', 'engineer', 'sales']), async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { siteId, key, package: pkg, months, price, till } = req.body;

    let contract = await ServiceContract.findOne({
      where: { siteCode: siteId, key },
      transaction: t,
    });

    const now = new Date();
    const expiry = till ? new Date(till) : null;

    if (!contract) {
      contract = await ServiceContract.create(
        {
          siteCode: siteId,
          key,
          start: now,
          expiry,
          package: pkg,
          suspended: false,
        },
        { transaction: t }
      );
    } else {
      await contract.update(
        { expiry, package: pkg, suspended: false },
        { transaction: t }
      );
    }

    await ServiceHistory.create(
      {
        contractId: contract.id,
        package: pkg,
        months: months || 0,
        price: price || 0,
        at: now,
        till: expiry,
        by: req.user.login || '-',
      },
      { transaction: t }
    );

    await t.commit();

    const updated = await ServiceContract.findByPk(contract.id, {
      include: [{ model: ServiceHistory, as: 'history' }],
    });
    res.json(toContractJSON(updated));
  } catch (e) {
    await t.rollback();
    next(e);
  }
});

module.exports = router;