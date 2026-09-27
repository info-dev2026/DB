/* ============================================================
   routes/portal/alerts.routes.js — Sequelize version
   ============================================================ */

const router = require('express').Router();
const { Alert } = require('../../models');
const auth = require('../../middleware/auth');

/* Helper: map DB row → JSON the frontend expects */
function toAlertJSON(a) {
  if (!a) return null;
  const p = a.toJSON ? a.toJSON() : a;
  return {
    _id: String(p.id),
    siteId: p.siteCode,
    site: p.siteName,
    param: p.param,
    level: p.level,
    reason: p.reason,
    acknowledged: p.acknowledged,
    ackBy: p.ackBy,
    ackAt: p.ackAt,
    emailed: p.emailed,
    ts: p.ts,
  };
}

/* GET /api/portal/alerts */
router.get('/', auth(), async (req, res, next) => {
  try {
    const where = req.user.role === 'industry' ? { siteCode: req.user.siteId } : {};
    const rows = await Alert.findAll({
      where,
      order: [['ts', 'DESC']],
      limit: 200,
    });
    res.json(rows.map(toAlertJSON));
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/portal/alerts/:id/ack */
router.patch('/:id/ack', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Not found' });

    await alert.update({
      acknowledged: true,
      ackBy: req.user.login,
      ackAt: new Date(),
    });

    res.json(toAlertJSON(alert));
  } catch (e) {
    next(e);
  }
});

module.exports = router;