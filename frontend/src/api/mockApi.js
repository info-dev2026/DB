/* =========================================================
   Mock API — swap this file for the real one when the backend
   is live. Every function returns a Promise so the calling code
   is identical in both modes.

   When you plug in the real backend:
     1. Set REACT_APP_API_BASE in frontend/.env
     2. Replace each mock function with a real fetch call
   ========================================================= */

import {
  buildSeedSites,
  buildSeedAlerts,
  buildSeedComplaints,
  buildSeedServices,
  DEFAULT_PACKAGES,
} from '../utils/mockData';

const DB_KEY = 'sz_mock_db_v3';

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/* ---------- persistent in-browser store ---------- */
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveDB(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {}
}

function initDB() {
  let db = loadDB();
  if (db) return db;

  const sites = buildSeedSites();
  const svcMap = buildSeedServices(sites);
  sites.forEach((s) => { s.services = svcMap[s.id]; s.catalogue = DEFAULT_PACKAGES; });

  db = {
    sites,
    alerts: buildSeedAlerts(sites),
    complaints: buildSeedComplaints(),
    users: [
      { id: 'U1', name: 'Administrator', role: 'admin', login: 'admin' },
      { id: 'U2', name: 'Chandan', role: 'engineer', login: 'chandan', mobile: '9818536015' },
      { id: 'U3', name: 'Sales Team', role: 'sales', login: 'sales' },
    ],
    creds: {
      adminPass: 'Rn4$KpV9!TzL3wXq',
      engLogin: 'chandan',
      engName: 'Chandan',
      engMobile: '9818536015',
      engPass: 'Dm8#WcF2@Ys6PbH5',
      salesLogin: 'sales',
      salesName: 'Saaphzone Technologies',
      salesPass: 'Qz5!Nt7#GxR2VkM9',
      salesMobile: '',
    },
    packages: DEFAULT_PACKAGES,
    lastPollTs: 0,
    savedAt: Date.now(),
  };
  saveDB(db);
  return db;
}

/* ---------- helpers ---------- */
const getDB = () => initDB();

const findSite = (db, id) => db.sites.find((s) => s.id === id);

/* ---------- exposed mock endpoints ---------- */

export const mockApi = {
  /* ---------- auth ---------- */
  async login(role, login, password) {
    await delay(300);
    const db = getDB();
    const c = db.creds;

    if (role === 'admin') {
      if (login === 'admin' && password === c.adminPass) {
        return { user: { role: 'admin', name: 'Saaphzone Technologies' } };
      }
      throw new Error('Invalid admin credentials.');
    }

    if (role === 'engineer') {
      const okUser = login.toLowerCase() === c.engLogin.toLowerCase() || login === 'engineer';
      if (okUser && password === c.engPass) {
        return { user: { role: 'engineer', name: c.engName, mobile: c.engMobile } };
      }
      throw new Error('Invalid service engineer credentials.');
    }

    if (role === 'sales') {
      const okUser = login.toLowerCase() === c.salesLogin.toLowerCase();
      if (okUser && password === c.salesPass) {
        return { user: { role: 'sales', name: c.salesName, mobile: c.salesMobile } };
      }
      throw new Error('Invalid sales credentials.');
    }

    /* industry */
    const code = login.trim().toUpperCase();
    const site = findSite(db, code);
    if (!site) throw new Error('Industry code not found.');
    if (password !== site.passcode) throw new Error('Incorrect passcode. Default is 1234.');
    return { user: { role: 'industry', name: site.name, siteId: site.id } };
  },

  /* ---------- sites ---------- */
  async listSites() {
    await delay();
    const db = getDB();
    return db.sites.map((s) => ({ ...s }));
  },

  async getSite(id) {
    await delay();
    const db = getDB();
    const site = findSite(db, id);
    if (!site) throw new Error('Site not found.');
    return { ...site };
  },

  async createSite(body) {
    await delay();
    const db = getDB();
    if (db.sites.find((s) => s.id.toUpperCase() === body.id.toUpperCase())) {
      throw new Error('That industry code already exists.');
    }
    db.sites.push({
      ...body,
      passcode: '1234',
      enabled: true,
      running: true,
      connectivity: 'live',
      lastData: 'just now',
      signal: 'green',
      services: {},
      catalogue: db.packages,
    });
    saveDB(db);
    return { ...body };
  },

  async updateSite(id, body) {
    await delay();
    const db = getDB();
    const idx = db.sites.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('Site not found.');
    db.sites[idx] = { ...db.sites[idx], ...body, id };
    saveDB(db);
    return { ...db.sites[idx] };
  },

  async deleteSite(id) {
    await delay();
    const db = getDB();
    db.sites = db.sites.filter((s) => s.id !== id);
    saveDB(db);
    return { ok: true };
  },

  async patchSiteState(id, patch) {
    await delay();
    const db = getDB();
    const site = findSite(db, id);
    if (!site) throw new Error('Site not found.');
    Object.assign(site, patch);
    if (patch.running === false) site.connectivity = 'grey';
    if (patch.running === true)  site.connectivity = 'live';
    saveDB(db);
    return { ...site };
  },

  /* ---------- alerts ---------- */
  async listAlerts() {
    await delay();
    return getDB().alerts.slice(0, 200);
  },

  async ackAlert(id) {
    await delay();
    const db = getDB();
    const a = db.alerts.find((x) => x.id === id);
    if (a) a.acknowledged = true;
    saveDB(db);
    return a || { ok: true };
  },

  /* ---------- complaints ---------- */
  async listComplaints() {
    await delay();
    return getDB().complaints.slice();
  },

  async createComplaint(body) {
    await delay();
    const db = getDB();
    const c = {
      id: 'CMP-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      ...body,
      status: 'open',
      time: Date.now(),
    };
    db.complaints.unshift(c);
    saveDB(db);
    return c;
  },

  async updateComplaint(id, patch) {
    await delay();
    const db = getDB();
    const c = db.complaints.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
    saveDB(db);
    return c || { ok: true };
  },

  /* ---------- services ---------- */
  async listContracts() {
    await delay();
    const db = getDB();
    const all = {};
    db.sites.forEach((s) => { if (s.services) all[s.id] = s.services; });
    return all;
  },

  async renewContract({ siteId, key, package: pkgId, from }) {
    await delay();
    const db = getDB();
    const site = findSite(db, siteId);
    if (!site) throw new Error('Site not found.');
    const group = key.split('|')[0];
    const tier = (site.catalogue?.[group]?.tiers || []).find((t) => t.id === pkgId);
    if (!tier) throw new Error('Package not found.');

    const cur = site.services?.[key];
    const base = (from === 'expiry' && cur?.expiry && new Date(cur.expiry) > new Date())
      ? new Date(cur.expiry)
      : new Date();
    base.setMonth(base.getMonth() + tier.months);

    if (!site.services) site.services = {};
    site.services[key] = {
      start: Date.now(),
      expiry: base.getTime(),
      package: pkgId,
      suspended: false,
      history: [
        ...((cur?.history) || []),
        { package: tier.label, months: tier.months, price: tier.price, at: Date.now(), till: base.getTime(), by: 'you' },
      ],
    };
    saveDB(db);
    return site.services[key];
  },

  /* ---------- reports ---------- */
  async getReportData({ siteId, from, to }) {
    await delay();
    const db = getDB();
    const site = findSite(db, siteId);
    if (!site) throw new Error('Site not found.');

    const readings = [];
    const step = 15 * 60 * 1000; // 15-minute readings
    for (let t = from; t <= to; t += step) {
      site.params.forEach((p) => {
        const def = p.limit || 100;
        const val = p.key === 'pH'
          ? +(7.0 + Math.sin(t / 3.6e6) * 0.6 + (Math.random() - 0.5) * 0.3).toFixed(2)
          : +(def * (0.5 + Math.random() * 0.35)).toFixed(2);
        readings.push({ siteId, param: p.key, value: val, ts: t });
      });
    }
    return { readings };
  },

  /* ---------- users & creds ---------- */
  async listUsers() {
    await delay();
    return getDB().users.slice();
  },

  async getCreds() {
    await delay();
    return { ...getDB().creds };
  },

  async changePassword({ target, current, new: newPass, login, name }) {
    await delay();
    const db = getDB();
    const c = db.creds;

    if (target === 'admin') {
      if (current !== c.adminPass) throw new Error('Current admin password is incorrect.');
      c.adminPass = newPass;
    } else if (target === 'engineer') {
      if (current !== c.adminPass) throw new Error('Admin authorisation failed.');
      c.engPass = newPass;
    } else if (target === 'sales') {
      if (current !== c.adminPass) throw new Error('Admin authorisation failed.');
      if (newPass) c.salesPass = newPass;
      if (login) c.salesLogin = login;
      if (name)  c.salesName = name;
    } else if (target === 'industry') {
      const site = db.sites.find((s) => s.id === db.sessionSiteId) ||
                   db.sites.find((s) => current === s.passcode);
      if (!site) throw new Error('Site not found.');
      if (current !== site.passcode) throw new Error('Current passcode is incorrect.');
      site.passcode = newPass;
    }

    saveDB(db);
    return { ok: true };
  },

  /* ---------- simulator (offline push) ---------- */
  pushSimulatedReading(siteId, param, value) {
    const db = getDB();
    const site = findSite(db, siteId);
    if (!site) return;
    const p = site.params.find((x) => x.key === param);
    if (!p) return;
    p.value = value;
    p.history.push(value);
    if (p.history.length > 24) p.history.shift();
    saveDB(db);
  },

  /* ---------- reset (dev helper) ---------- */
  reset() {
    localStorage.removeItem(DB_KEY);
    return initDB();
  },
};

export const MOCK_MODE = true;