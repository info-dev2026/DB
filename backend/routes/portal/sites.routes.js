/* ============================================================
   routes/portal/sites.routes.js — Sequelize version
   Includes per-site notification emails (notifyEmails)
   ============================================================ */

const router = require('express').Router();
const { Site, Param, sequelize } = require('../../models');
const auth = require('../../middleware/apiKeyAuth');
const { broadcast } = require('../../services/socketService');
const { gradeParameter, rollup } = require('../../services/cpcbEngine');
const {
  isNumericPid,
  getExistingNumericPidsSet,
  getNextNumericPids,
  getNextNumericPid,
  generateParamIdFromStack,
} = require('../../utils/pidGenerator');

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

  const mappedParams = (plain.params || []).map((p) => {
    const hasValue = p.value != null && !isNaN(Number(p.value));
    let paramSig = 'grey';
    if (hasValue) {
      if (p.signal && p.signal !== 'grey') {
        paramSig = p.signal;
      } else {
        paramSig = gradeParameter(p);
      }
    }
    return {
      // keep the exact shape the frontend expects
      _id: String(p.id),
      key: p.key,
      name: p.name || p.key,
      pid: p.pid,
      unit: p.unit || '',
      limit: p.limit != null ? Number(p.limit) : 0,
      min: p.min != null ? Number(p.min) : null,
      value: hasValue ? Number(p.value) : null,
      hasReceivedData: hasValue,
      phVal: p.phVal != null ? Number(p.phVal) : null,
      signal: paramSig,
      yToday: p.yToday || 0,
      y30: p.y30 || 0,
      y30conn: p.y30conn || 0,
      connHrs: p.connHrs || 0,
      connFailHrsToday: p.connFailHrsToday || 0,
      stableHrs: p.stableHrs || 0,
      excStreak: p.excStreak || 0,
      redCount30: p.redCount30 || 0,
      history: Array.isArray(p.history) ? p.history : [],
      updatedAt: hasValue ? (p.updatedAt || new Date().toISOString()) : null,
      lastData: hasValue ? (p.lastData || 'just now') : 'No data',
    };
  });

  const hasAnyParamData = mappedParams.some((p) => p.hasReceivedData);
  const now = Date.now();
  const lastSeenMs = plain.lastSeenAt ? new Date(plain.lastSeenAt).getTime() : 0;
  const elapsedMin = lastSeenMs > 0 ? Math.round((now - lastSeenMs) / 60000) : 999999;
  const isRecentlySeen = elapsedMin <= 30;

  const effectiveConnectivity =
    plain.enabled === false
      ? 'grey'
      : (hasAnyParamData && isRecentlySeen) || plain.connectivity === 'live'
      ? (elapsedMin > 15 ? 'delay' : 'live')
      : (plain.connectivity || (hasAnyParamData ? 'live' : 'grey'));

  const effectiveSignal = rollup(mappedParams, effectiveConnectivity, plain.enabled);

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
    connectivity: effectiveConnectivity,
    enabled: plain.enabled,
    running: plain.running,
    lastData: plain.lastData,
    lastSeenAt: plain.lastSeenAt,
    signal: effectiveSignal,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    params: mappedParams,
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
   GET /api/portal/sites/next-param-id — auto allocate unique numeric PIDs
   ------------------------------------------------------------ */
router.get('/next-param-id', auth(), async (req, res, next) => {
  try {
    const count = Math.max(1, parseInt(req.query.count, 10) || 1);
    const pids = await getNextNumericPids(count, [], Param);
    res.json({ ok: true, pids, pid: pids[0] });
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
      const siteUsedPids = new Set();
      const resolvedPids = [];

      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        let rawPid = p && p.pid != null ? String(p.pid).trim() : '';

        // Auto-generate on behalf of Stack Name (character + number) if not provided
        if (!rawPid) {
          const stackName = p.name || p.stackName || `STACK ${i + 1}`;
          rawPid = generateParamIdFromStack(stackName, p.key, site.siteCode);
        }

        // Avoid duplicate within the same site
        if (siteUsedPids.has(rawPid.toUpperCase())) {
          rawPid = `${rawPid}-${i + 1}`;
        }
        siteUsedPids.add(rawPid.toUpperCase());
        resolvedPids.push(rawPid);
      }

      const paramRows = params.map((p, i) => ({
        siteCode: site.siteCode,
        key: p.key,
        name: p.name || p.key,
        pid: resolvedPids[i],
        unit: p.unit || '',
        limit: p.limit != null ? p.limit : 0,
        min: p.min != null ? p.min : null,
        value: p.value != null && p.value !== '' && p.value !== 'NA' ? p.value : null,
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
      const existingParams = await Param.findAll({
        where: { siteCode: site.siteCode },
        transaction: t,
      });
      const existingMap = new Map();
      existingParams.forEach((ep) => {
        if (ep.pid) existingMap.set(ep.pid.toUpperCase().trim(), ep);
      });

      await Param.destroy({
        where: { siteCode: site.siteCode },
        transaction: t,
      });

      if (params.length) {
        const siteUsedPids = new Set();
        const resolvedPids = [];

        for (let i = 0; i < params.length; i++) {
          const p = params[i];
          let rawPid = p && p.pid != null ? String(p.pid).trim() : '';

          // Auto-generate on behalf of Stack Name (character + number) if not provided
          if (!rawPid) {
            const stackName = p.name || p.stackName || `STACK ${i + 1}`;
            rawPid = generateParamIdFromStack(stackName, p.key, site.siteCode);
          }

          // Avoid duplicate within the same site
          if (siteUsedPids.has(rawPid.toUpperCase())) {
            rawPid = `${rawPid}-${i + 1}`;
          }
          siteUsedPids.add(rawPid.toUpperCase());
          resolvedPids.push(rawPid);
        }

        const rows = params.map((p, idx) => {
          const ep = existingMap.get((p.pid || '').toUpperCase().trim()) || existingParams[idx];
          const hasExistingVal = ep?.value != null && !isNaN(Number(ep.value));
          const hasPassedVal = p.value != null && p.value !== '' && p.value !== 'NA' && !isNaN(Number(p.value));

          let val = null;
          if (hasPassedVal) val = Number(p.value);
          else if (hasExistingVal) val = Number(ep.value);

          const paramName = (p.name && String(p.name).trim()) ? String(p.name).trim() : (ep?.name || p.key);

          return {
            siteCode: site.siteCode,
            key: p.key,
            name: paramName,
            pid: resolvedPids[idx],
            unit: p.unit || ep?.unit || '',
            limit: p.limit != null ? Number(p.limit) : (ep?.limit != null ? Number(ep.limit) : 0),
            min: p.min != null ? Number(p.min) : (ep?.min != null ? Number(ep.min) : null),
            value: val,
            phVal: p.phVal != null ? p.phVal : ep?.phVal,
            signal: val != null ? (p.signal || ep?.signal || 'green') : 'grey',
            yToday: p.yToday != null ? p.yToday : (ep?.yToday || 0),
            y30: p.y30 != null ? p.y30 : (ep?.y30 || 0),
            y30conn: p.y30conn != null ? p.y30conn : (ep?.y30conn || 0),
            connHrs: p.connHrs != null ? p.connHrs : (ep?.connHrs || 0),
            connFailHrsToday: p.connFailHrsToday != null ? p.connFailHrsToday : (ep?.connFailHrsToday || 0),
            stableHrs: p.stableHrs != null ? p.stableHrs : (ep?.stableHrs || 0),
            excStreak: p.excStreak != null ? p.excStreak : (ep?.excStreak || 0),
            redCount30: p.redCount30 != null ? p.redCount30 : (ep?.redCount30 || 0),
            history: Array.isArray(p.history) && p.history.length ? p.history : (ep?.history || []),
          };
        });
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
   PATCH /api/portal/sites/:id/params/:pid — update parameter name & limits
   ------------------------------------------------------------ */
router.patch('/:id/params/:pid', auth(['admin', 'engineer']), async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const site = await Site.findOne({
      where: { siteCode: req.params.id },
      transaction: t,
    });
    if (!site) {
      await t.rollback();
      return res.status(404).json({ error: 'Site not found' });
    }

    const cleanPid = decodeURIComponent(req.params.pid).trim().toUpperCase();
    const allParams = await Param.findAll({
      where: { siteCode: site.siteCode },
      transaction: t,
    });

    const param = allParams.find((p) => p.pid && p.pid.toUpperCase().trim() === cleanPid);
    if (!param) {
      await t.rollback();
      return res.status(404).json({ error: `Parameter with PID "${cleanPid}" not found` });
    }

    const { name, limit, min, unit, pid: newPid } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name ? String(name).trim() : param.key;
    if (limit !== undefined && !isNaN(Number(limit))) updates.limit = Number(limit);
    if (min !== undefined) updates.min = min !== null ? Number(min) : null;
    if (newPid !== undefined && String(newPid).trim()) {
      const sanitized = String(newPid).trim().replace(/\D/g, '');
      if (!sanitized) {
        await t.rollback();
        return res.status(400).json({ error: 'Parameter ID must be a numeric value only' });
      }
      const conflict = await Param.findOne({
        where: { pid: sanitized },
        transaction: t,
      });
      if (conflict && conflict.id !== param.id) {
        await t.rollback();
        return res.status(409).json({ error: `Parameter ID "${sanitized}" is already in use by another parameter` });
      }
      updates.pid = sanitized;
    }

    await param.update(updates, { transaction: t });
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
   POST /api/portal/sites/:id/sync — immediate telemetry sync
   ------------------------------------------------------------ */
router.post('/:id/sync', auth(), async (req, res, next) => {
  try {
    const site = await Site.findOne({
      where: { siteCode: req.params.id },
      include: [{ model: Param, as: 'params' }],
    });
    if (!site) return res.status(404).json({ error: 'Not found' });

    const nowIso = new Date().toISOString();
    await site.update({
      lastSeenAt: nowIso,
      lastData: 'just now',
      connectivity: 'live',
    });

    for (const p of site.params || []) {
      const isPh = p.key === 'pH';
      const lim = p.limit || 100;
      const sign = Math.random() > 0.5 ? 1 : -1;
      const pctShift = 0.015 + Math.random() * 0.035;
      const delta = sign * (lim * pctShift);
      let newVal = isPh
        ? +(Math.min(8.4, Math.max(6.9, Number(p.value || 7.2) + sign * (0.06 + Math.random() * 0.08)))).toFixed(2)
        : Math.max(0.1, +(Number(p.value || 10) + delta).toFixed(1));

      const history = Array.isArray(p.history) ? [...p.history] : [];
      history.push(newVal);
      if (history.length > 24) history.shift();

      await p.update({
        value: newVal,
        history,
        connHrs: 0,
        connFailHrsToday: 0,
      });
    }

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