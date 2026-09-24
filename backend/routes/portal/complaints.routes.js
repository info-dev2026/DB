const router = require('express').Router();
const Complaint = require('../../models/Complaint');
const auth = require('../../middleware/auth');
const { broadcast } = require('../../services/socketService');

/* GET /api/portal/complaints — role-filtered */
router.get('/', auth(), async (req, res, next) => {
  try {
    const filter =
      req.user.role === 'industry' ? { siteId: req.user.siteId } : {};
    const list = await Complaint.find(filter).sort({ time: -1 });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

/* POST /api/portal/complaints */
router.post('/', auth(), async (req, res, next) => {
  try {
    const c = await Complaint.create({
      ...req.body,
      by: req.body.by || req.user.name || 'industry',
    });
    broadcast('complaint:new', c.toObject());
    res.json(c);
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/portal/complaints/:id — status change */
router.patch('/:id', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const c = await Complaint.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!c) return res.status(404).json({ error: 'Not found' });

    broadcast('complaint:update', {
      id: c._id.toString(),
      status: c.status,
      by: req.user.name,
      ts: Date.now(),
    });

    res.json(c);
  } catch (e) {
    next(e);
  }
});

module.exports = router;