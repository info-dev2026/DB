/* ============================================================
   routes/portal/alerts.routes.js — Sequelize version
   ============================================================ */

const router = require('express').Router();
const { Alert } = require('../../models');
const auth = require('../../middleware/apiKeyAuth');
const { broadcast } = require('../../services/socketService');

/* Helper: map DB row → JSON the frontend expects */
function toAlertJSON(a) {
  if (!a) return null;
  const p = a.toJSON ? a.toJSON() : a;
  return {
    _id: String(p.id),
    id: String(p.id),
    siteId: p.siteCode,
    site: p.siteName,
    param: p.param,
    level: p.level,
    reason: p.reason,
    acknowledged: !!p.acknowledged,
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

/* PATCH /api/portal/alerts/ack-all */
router.patch('/ack-all', auth(), async (req, res, next) => {
  try {
    const where = { acknowledged: false };
    if (req.user.role === 'industry') {
      where.siteCode = req.user.siteId;
    }
    await Alert.update(
      {
        acknowledged: true,
        ackBy: req.user.login || req.user.name || req.user.siteId || 'user',
        ackAt: new Date(),
      },
      { where }
    );

    const ackAllPayload = { siteId: req.user.role === 'industry' ? req.user.siteId : null };
    broadcast('alert:ackAll', ackAllPayload);
    const io = req.app.get('io');
    if (io) io.emit('alert:ackAll', ackAllPayload);

    res.json({ ok: true, message: 'All alerts marked as read' });
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/portal/alerts/:id/ack */
router.patch('/:id/ack', auth(), async (req, res, next) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'industry' && alert.siteCode !== req.user.siteId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await alert.update({
      acknowledged: true,
      ackBy: req.user.login || req.user.name || req.user.siteId || 'user',
      ackAt: new Date(),
    });

    const json = toAlertJSON(alert);
    const ackPayload = { id: String(alert.id), acknowledged: true };
    broadcast('alert:ack', ackPayload);
    const io = req.app.get('io');
    if (io) io.emit('alert:ack', ackPayload);

    res.json(json);
  } catch (e) {
    next(e);
  }
});

module.exports = router;