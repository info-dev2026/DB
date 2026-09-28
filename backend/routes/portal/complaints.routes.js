/* ============================================================
   routes/portal/complaints.routes.js — Sequelize version
   ============================================================ */

const router = require('express').Router();
const { Complaint } = require('../../models');
const auth = require('../../middleware/apiKeyAuth');

function toComplaintJSON(c) {
  if (!c) return null;
  const p = c.toJSON ? c.toJSON() : c;
  return {
    _id: String(p.id),
    siteId: p.siteCode,
    site: p.siteName,
    cat: p.cat,
    msg: p.msg,
    status: p.status,
    by: p.by,
    time: p.time,
  };
}

/* GET /api/portal/complaints */
router.get('/', auth(), async (req, res, next) => {
  try {
    const where = req.user.role === 'industry' ? { siteCode: req.user.siteId } : {};
    const rows = await Complaint.findAll({
      where,
      order: [['time', 'DESC']],
    });
    res.json(rows.map(toComplaintJSON));
  } catch (e) {
    next(e);
  }
});

/* POST /api/portal/complaints */
router.post('/', auth(['admin', 'engineer', 'industry']), async (req, res, next) => {
  try {
    const { siteId, site, cat, msg } = req.body;
    if (!msg) return res.status(400).json({ error: 'Message required' });

    const c = await Complaint.create({
      siteCode: siteId || req.user.siteId,
      siteName: site || '-',
      cat: cat || 'Other',
      msg,
      by: req.user.login || '-',
      time: new Date(),
    });

    res.status(201).json(toComplaintJSON(c));
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/portal/complaints/:id */
router.patch('/:id', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const c = await Complaint.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    await c.update(req.body);
    res.json(toComplaintJSON(c));
  } catch (e) {
    next(e);
  }
});

module.exports = router;