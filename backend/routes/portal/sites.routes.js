const router = require('express').Router();
const Site = require('../../models/Site');
const auth = require('../../middleware/auth');
const { broadcast } = require('../../services/socketService');

/* GET /api/portal/sites — role-filtered */
router.get('/', auth(), async (req, res, next) => {
  try {
    const filter = req.user.role === 'industry' ? { id: req.user.siteId } : {};
    const sites = await Site.find(filter).sort({ signal: -1 });
    res.json(sites);
  } catch (e) {
    next(e);
  }
});

/* GET /api/portal/sites/:id */
router.get('/:id', auth(), async (req, res, next) => {
  try {
    const s = await Site.findOne({ id: req.params.id });
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json(s);
  } catch (e) {
    next(e);
  }
});

/* POST /api/portal/sites — create */
router.post('/', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const body = { ...req.body };

    /* ---------- Passcode is mandatory ---------- */
    const passcode = (body.passcode || '').trim();
    if (!passcode) {
      return res.status(400).json({ error: 'Passcode is required' });
    }
    if (passcode.length < 4) {
      return res.status(400).json({
        error: 'Passcode must be at least 4 characters',
      });
    }
    body.passcode = passcode;

    const s = await Site.create(body);
    broadcast('site:new', s.toObject());
    res.json(s);
  } catch (e) {
    next(e);
  }
});

/* PUT /api/portal/sites/:id — update */
router.put('/:id', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const s = await Site.findOneAndUpdate({ id: req.params.id }, req.body, {
      new: true,
    });
    if (!s) return res.status(404).json({ error: 'Not found' });
    broadcast('site:update', { siteId: s.id, signal: s.signal, params: s.params });
    res.json(s);
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/portal/sites/:id/state — start/stop/visibility */
router.patch('/:id/state', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const s = await Site.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true }
    );
    if (!s) return res.status(404).json({ error: 'Not found' });
    broadcast('site:update', { siteId: s.id, signal: s.signal, params: s.params });
    res.json(s);
  } catch (e) {
    next(e);
  }
});

/* DELETE /api/portal/sites/:id — admin only */
router.delete('/:id', auth('admin'), async (req, res, next) => {
  try {
    await Site.deleteOne({ id: req.params.id });
    broadcast('site:delete', { siteId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;