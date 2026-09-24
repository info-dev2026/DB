const router = require('express').Router();
const Alert = require('../../models/Alert');
const auth = require('../../middleware/auth');
const { broadcast } = require('../../services/socketService');

/* GET /api/portal/alerts — role-filtered */
router.get('/', auth(), async (req, res, next) => {
  try {
    const filter =
      req.user.role === 'industry' ? { siteId: req.user.siteId } : {};
    const alerts = await Alert.find(filter).sort({ ts: -1 }).limit(200);
    res.json(alerts);
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/portal/alerts/:id/ack */
router.patch('/:id/ack', auth(), async (req, res, next) => {
  try {
    const a = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        acknowledged: true,
        ackBy: req.user.name,
        ackAt: new Date(),
      },
      { new: true }
    );
    if (!a) return res.status(404).json({ error: 'Not found' });

    broadcast('alert:ack', {
      id: a._id.toString(),
      by: req.user.name,
      ts: Date.now(),
    });

    res.json(a);
  } catch (e) {
    next(e);
  }
});

module.exports = router;