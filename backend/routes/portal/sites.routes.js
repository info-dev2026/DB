/* ============================================================
   routes/portal/sites.routes.js — Sequelize version
   Includes per-site notification emails (notifyEmails)
   ============================================================ */

const router = require('express').Router();
const { Site, Param, sequelize } = require('../../models');
const auth = require('../../middleware/apiKeyAuth');
const { broadcast } = require('../../services/socketService');

/* ------------------------------------------------------------
   Validate & normalize notification emails.
   Accepts: array of strings, comma-separated string, or empty.
   Returns: array of valid, lowercased, deduplicated emails.
   ------------------------------------------------------------ */
function cleanEmails(input) {
  if (!input) return [];
  let list = [];
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === 'string') {
    list = input.split(/[,\s;]+/);
  } else {
    return [];
  }
  const seen = new Set();
  const cleaned = [];
  for (const raw of list) {
    const e = String(raw).trim().toLowerCase();
    if (!e) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    cleaned.push(e);
  }
  return cleaned;
}

/* ------------------------------------------------------------
   Helper: convert a Sequelize Site (with params included)
   into the JSON shape the frontend expects.
   ------------------------------------------------------------ */
function toSiteJSON(site) {
  if (!site) return null;
  const plain = site.toJSON ? site.toJSON() : site;

  return {
    // Frontend expects `id` to be the site code (e.g. "ESK-4417")
    id: plain.siteCode,
    siteCode: plain.siteCode,
    name: plain.name,
    deviceType: plain.deviceType || plain.device_type || 'Water Analyzer',
    sector: plain.sector,
    loc: plain.loc,
    lat: plain.lat != null ? Number(plain.lat) : 28.6,
    lng: plain.lng != null ? Number(plain.lng) : 77.2,
    spcb: plain.spcb,
    category: plain.category,
    stacks: plain.stacks,
    etp: plain.etp,
    contact: plain.contact,
    phone: plain.phone,
    email: plain.email,
    passcode: plain.passcode,

    // Notification emails
    notifyEmails: Array.isArray(plain.notifyEmails) ? plain.notifyEmails : [],

    ganga: plain.ganga,
    connectivity: plain.connectivity,
    enabled: plain.enabled,
    running: plain.running,
    lastData: plain.lastData,
    lastSeenAt: plain.lastSeenAt,
    signal: plain.signal,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    params: (plain.params || []).map((p) => ({
      // keep the exact shape the frontend expects
      _id: String(p.id),
      key: p.key,
      name: p.name || p.key,
      pid: p.pid,
      unit: p.unit || '',
      limit: p.limit != null ? Number(p.limit) : 0,
      min: p.min != null ? Number(p.min) : null,
      value: p.value != null ? Number(p.value) : 0,
      phVal: p.phVal != null ? Number(p.phVal) : null,
      signal: p.signal || 'green',
      yToday: p.yToday || 0,
      y30: p.y30 || 0,
      y30conn: p.y30conn || 0,
      connHrs: p.connHrs || 0,
      connFailHrsToday: p.connFailHrsToday || 0,
      stableHrs: p.stableHrs || 0,
      excStreak: p.excStreak || 0,
      redCount30: p.redCount30 || 0,
      history: Array.isArray(p.history) ? p.history : [],
    })),
  };
}

/* ------------------------------------------------------------
   GET /api/portal/sites — role-filtered
   ------------------------------------------------------------ */
router.get('/', auth(), async (req, res, next) => {
  try {
    const where = req.user.role === 'industry' ? { siteCode: req.user.siteId } : {};
    const orderDir = req.query.order === 'ASC' ? 'ASC' : 'DESC';
    const sortBy = req.query.sort === 'signal' ? 'signal' : 'createdAt';
    const sites = await Site.findAll({
      where,
      include: [{ model: Param, as: 'params' }],
      order: [[sortBy, orderDir]],
    });
    res.json(sites.map(toSiteJSON));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   GET /api/portal/sites/:id
   ------------------------------------------------------------ */
router.get('/:id', auth(), async (req, res, next) => {
  try {
    const site = await Site.findOne({
      where: { siteCode: req.params.id },
      include: [{ model: Param, as: 'params' }],
    });
    if (!site) return res.status(404).json({ error: 'Not found' });
    res.json(toSiteJSON(site));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   POST /api/portal/sites — create (with nested params)
   ------------------------------------------------------------ */
router.post('/', auth(['admin', 'engineer']), async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const body = { ...req.body };

    /* ---------- Passcode validation ---------- */
    const passcode = (body.passcode || '').trim();
    if (!passcode) {
      await t.rollback();
      return res.status(400).json({ error: 'Passcode is required' });
    }
    if (passcode.length < 4) {
      await t.rollback();
      return res.status(400).json({
        error: 'Passcode must be at least 4 characters',
      });
    }

    /* ---------- Split site fields and params ---------- */
    const { params = [], id, ...siteFields } = body;

    /* ---------- Normalize notification emails ---------- */
    siteFields.notifyEmails = cleanEmails(body.notifyEmails);

    /* ---------- Create site ---------- */
    const site = await Site.create(
      {
        siteCode: id,
        passcode,
        ...siteFields,
      },
      { transaction: t }
    );

    /* ---------- Create params (if any) ---------- */
    if (Array.isArray(params) && params.length) {
      const paramRows = params.map((p) => ({
        siteCode: site.siteCode,
        key: p.key,
        name: p.name || p.key,
        pid: p.pid,
        unit: p.unit || '',
        limit: p.limit != null ? p.limit : 0,
        min: p.min != null ? p.min : null,
        value: p.value != null ? p.value : 0,
        phVal: p.phVal != null ? p.phVal : null,
        signal: p.signal || 'green',
        history: p.history || [],
      }));
      await Param.bulkCreate(paramRows, { transaction: t });
    }

    await t.commit();

    /* ---------- Re-fetch with params included ---------- */
    const created = await Site.findOne({
      where: { id: site.id },
      include: [{ model: Param, as: 'params' }],
    });

    const json = toSiteJSON(created);
    broadcast('site:new', json);
    res.status(201).json(json);
  } catch (e) {
    await t.rollback();

    if (e.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        error: `Site code "${req.body.id}" already exists`,
      });
    }
    if (e.name === 'SequelizeValidationError') {
      return res.status(400).json({
        error: e.errors.map((x) => x.message).join('; '),
      });
    }
    next(e);
  }
});

/* ------------------------------------------------------------
   PUT /api/portal/sites/:id — update
   ------------------------------------------------------------ */
router.put('/:id', auth(['admin', 'engineer']), async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const site = await Site.findOne({
      where: { siteCode: req.params.id },
      transaction: t,
    });
    if (!site) {
      await t.rollback();
      return res.status(404).json({ error: 'Not found' });
    }

    const { params, id, ...siteFields } = req.body;

    /* ---------- Normalize notification emails (if provided) ---------- */
    if ('notifyEmails' in req.body) {
      siteFields.notifyEmails = cleanEmails(req.body.notifyEmails);
    }

    /* ---------- Update site fields ---------- */
    if ('passcode' in siteFields && !String(siteFields.passcode).trim()) {
      delete siteFields.passcode;
    }
    await site.update(siteFields, { transaction: t });

    /* ---------- Replace params if provided ---------- */
    if (Array.isArray(params)) {
      await Param.destroy({
        where: { siteCode: site.siteCode },
        transaction: t,
      });
      if (params.length) {
        const rows = params.map((p) => ({
          siteCode: site.siteCode,
          key: p.key,
          name: p.name || p.key,
          pid: p.pid,
          unit: p.unit || '',
          limit: p.limit != null ? p.limit : 0,
          min: p.min != null ? p.min : null,
          value: p.value != null ? p.value : 0,
          phVal: p.phVal != null ? p.phVal : null,
          signal: p.signal || 'green',
          yToday: p.yToday != null ? p.yToday : 0,
          y30: p.y30 != null ? p.y30 : 0,
          y30conn: p.y30conn != null ? p.y30conn : 0,
          connHrs: p.connHrs != null ? p.connHrs : 0,
          connFailHrsToday: p.connFailHrsToday != null ? p.connFailHrsToday : 0,
          stableHrs: p.stableHrs != null ? p.stableHrs : 0,
          excStreak: p.excStreak != null ? p.excStreak : 0,
          redCount30: p.redCount30 != null ? p.redCount30 : 0,
          history: Array.isArray(p.history) ? p.history : [],
        }));
        await Param.bulkCreate(rows, { transaction: t });
      }
    }

    await t.commit();

    const updated = await Site.findOne({
      where: { id: site.id },
      include: [{ model: Param, as: 'params' }],
    });
    const json = toSiteJSON(updated);
    broadcast('site:update', { siteId: json.id, signal: json.signal, params: json.params });
    res.json(json);
  } catch (e) {
    await t.rollback();
    next(e);
  }
});

/* ------------------------------------------------------------
   PATCH /api/portal/sites/:id/state — start/stop/visibility
   ------------------------------------------------------------ */
router.patch('/:id/state', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const site = await Site.findOne({ where: { siteCode: req.params.id } });
    if (!site) return res.status(404).json({ error: 'Not found' });

    await site.update(req.body);

    const updated = await Site.findOne({
      where: { id: site.id },
      include: [{ model: Param, as: 'params' }],
    });
    const json = toSiteJSON(updated);
    broadcast('site:update', { siteId: json.id, signal: json.signal, params: json.params });
    res.json(json);
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   DELETE /api/portal/sites/:id — admin only
   (params/alerts/readings/complaints cascade via FK)
   ------------------------------------------------------------ */
router.delete('/:id', auth(['admin']), async (req, res, next) => {
  try {
    const deleted = await Site.destroy({
      where: { siteCode: req.params.id },
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    broadcast('site:delete', { siteId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;