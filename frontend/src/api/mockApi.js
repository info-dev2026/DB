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

export const OFFICIAL_CREDS = {
  adminPass: 'Rn4$KpV9!TzL3wXq',
  engLogin: 'chandan',
  engName: 'Chandan',
  engMobile: '9818536015',
  engPass: 'Dm8#WcF2@Ys6PbH5',
  salesLogin: 'sales',
  salesName: 'Saaphzone Technologies',
  salesPass: 'Qz5!Nt7#GxR2VkM9',
  salesMobile: '',
};

export const OFFICIAL_USERS = [
  { id: 'U1', name: 'Administrator', role: 'admin', login: 'admin' },
  { id: 'U2', name: 'Chandan', role: 'engineer', login: 'chandan', mobile: '9818536015' },
  { id: 'U3', name: 'Sales Team', role: 'sales', login: 'sales' },
];

const DB_KEY = 'sz_mock_db_v4';

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/* ---------- persistent in-browser store ---------- */
function loadDB() {
  try {
    // Clear obsolete localStorage stores that held legacy default passwords (e.g. admin123)
    try {
      localStorage.removeItem('sz_mock_db');
      localStorage.removeItem('sz_mock_db_v2');
      localStorage.removeItem('sz_mock_db_v3');
    } catch {}

    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      let changed = false;

      // Always synchronize and enforce official credentials and user profiles
      if (
        !db.creds ||
        db.creds.adminPass !== OFFICIAL_CREDS.adminPass ||
        db.creds.engPass !== OFFICIAL_CREDS.engPass ||
        db.creds.salesPass !== OFFICIAL_CREDS.salesPass ||
        db.creds.engLogin !== OFFICIAL_CREDS.engLogin ||
        db.creds.adminPass === 'admin123' ||
        db.creds.engPass === 'engineer123' ||
        db.creds.salesPass === 'sales123'
      ) {
        db.creds = { ...OFFICIAL_CREDS };
        db.users = [...OFFICIAL_USERS];
        changed = true;
      }

      if (Array.isArray(db.sites)) {
        db.sites.forEach((site) => {
          if (Array.isArray(site.params)) {
            site.params.forEach((p) => {
              if (p.key === 'SO2') {
                p.key = 'SOX';
                changed = true;
              }
              if (p.pid && p.pid.includes('SO2')) {
                p.pid = p.pid.replace(/SO2/g, 'SOX');
                changed = true;
              }
              if (typeof p.name === 'string' && p.name.includes('SO2')) {
                p.name = p.name.replace(/SO2/g, 'SOX');
                changed = true;
              }
            });
          }
        });
      }
      if (Array.isArray(db.alerts)) {
        db.alerts.forEach((a) => {
          if (a.param === 'SO2') {
            a.param = 'SOX';
            changed = true;
          }
        });
      }
      if (changed) saveDB(db);
      return db;
    }
  } catch {}
  return null;
}

function saveDB(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {}
}

function initDB() {
  let db = loadDB();
  if (db) {
    let changed = false;

    // Enforce credentials check on init
    if (
      !db.creds ||
      db.creds.adminPass !== OFFICIAL_CREDS.adminPass ||
      db.creds.engPass !== OFFICIAL_CREDS.engPass ||
      db.creds.salesPass !== OFFICIAL_CREDS.salesPass ||
      db.creds.engLogin !== OFFICIAL_CREDS.engLogin
    ) {
      db.creds = { ...OFFICIAL_CREDS };
      db.users = [...OFFICIAL_USERS];
      changed = true;
    }

    db.sites = (db.sites || []).map((s, idx) => {
      let siteChanged = false;
      const params = (s.params || []).map((p, pIdx) => {
        let pCopy = { ...p };
        let pModified = false;
        if (!pCopy.name) {
          pCopy.name = pCopy.key;
          pModified = true;
        }
        if (!pCopy.updatedAt) {
          const isDelay = s.scenario === 'delay' || s.connectivity === 'delay' || (pCopy.connHrs >= 4);
          const mins = isDelay ? 252 : (pIdx * 2 + 1);
          pCopy.updatedAt = new Date(Date.now() - mins * 60 * 1000).toISOString();
          pCopy.lastData = isDelay ? '4h 12m ago' : (mins <= 1 ? 'just now' : `${mins}m ago`);
          pModified = true;
        }
        if (pModified) siteChanged = true;
        return pCopy;
      });
      if (siteChanged) {
        changed = true;
        s = { ...s, params };
      }
      if (!s.createdAt) {
        changed = true;
        return {
          ...s,
          createdAt: new Date(Date.now() - (db.sites.length - idx) * 14 * 86400000).toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return s;
    });
    if (changed) saveDB(db);
    return db;
  }

  const sites = buildSeedSites();
  const svcMap = buildSeedServices(sites);
  sites.forEach((s) => { s.services = svcMap[s.id]; s.catalogue = DEFAULT_PACKAGES; });

  db = {
    sites,
    alerts: buildSeedAlerts(sites),
    complaints: buildSeedComplaints(),
    users: [...OFFICIAL_USERS],
    creds: { ...OFFICIAL_CREDS },
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
    const c = db.creds || OFFICIAL_CREDS;

    if (role === 'admin') {
      const okUser = String(login).toLowerCase().trim() === 'admin';
      const okPass = password === c.adminPass || password === OFFICIAL_CREDS.adminPass;
      if (okUser && okPass) {
        return { user: { role: 'admin', name: 'Administrator' } };
      }
      throw new Error('Invalid admin credentials.');
    }

    if (role === 'engineer') {
      const cleanUser = String(login).toLowerCase().trim();
      const dbEng = (db.users || []).find(
        (u) => u.role === 'engineer' && String(u.login).toLowerCase().trim() === cleanUser
      );
      if (dbEng) {
        const expectedPass = dbEng.password || c.engPass || OFFICIAL_CREDS.engPass;
        if (password === expectedPass) {
          return { user: { id: dbEng.id, role: 'engineer', name: dbEng.name, mobile: dbEng.mobile || '', email: dbEng.email || '' } };
        }
        throw new Error('Invalid service engineer credentials.');
      }
      const okUser = cleanUser === (c.engLogin || '').toLowerCase() ||
                     cleanUser === 'chandan' ||
                     cleanUser === 'engineer';
      const okPass = password === c.engPass || password === OFFICIAL_CREDS.engPass;
      if (okUser && okPass) {
        return { user: { role: 'engineer', name: c.engName || OFFICIAL_CREDS.engName, mobile: c.engMobile || OFFICIAL_CREDS.engMobile } };
      }
      throw new Error('Invalid service engineer credentials.');
    }

    if (role === 'sales') {
      const cleanUser = String(login).toLowerCase().trim();
      const okUser = cleanUser === (c.salesLogin || '').toLowerCase() ||
                     cleanUser === 'sales';
      const okPass = password === c.salesPass || password === OFFICIAL_CREDS.salesPass;
      if (okUser && okPass) {
        return { user: { role: 'sales', name: c.salesName || OFFICIAL_CREDS.salesName, mobile: c.salesMobile || OFFICIAL_CREDS.salesMobile } };
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
    const now = new Date().toISOString();
    const newSite = {
      ...body,
      passcode: '1234',
      enabled: true,
      running: true,
      connectivity: 'live',
      lastData: 'just now',
      signal: 'green',
      services: {},
      catalogue: db.packages,
      createdAt: now,
      updatedAt: now,
    };
    db.sites.push(newSite);
    saveDB(db);
    return { ...newSite };
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

  async updateParam(siteId, pid, body) {
    await delay();
    const db = getDB();
    const site = findSite(db, siteId);
    if (!site) throw new Error('Site not found.');
    const param = (site.params || []).find((p) => p.pid?.toUpperCase() === pid?.toUpperCase());
    if (!param) throw new Error('Parameter not found.');
    Object.assign(param, body);
    saveDB(db);
    return { ...site };
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

  async syncTelemetry(id) {
    await delay(150);
    const db = getDB();
    const site = findSite(db, id);
    if (!site) return (db.sites || []).map((s) => ({ ...s }));

    const nowIso = new Date().toISOString();
    site.lastData = 'just now';
    site.lastSeenAt = nowIso;
    site.connectivity = 'live';

    site.params = (site.params || []).map((p) => {
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

      return {
        ...p,
        value: newVal,
        history,
        updatedAt: nowIso,
        lastData: 'just now',
        connHrs: 0,
        connFailHrsToday: 0,
      };
    });

    site.updatedAt = nowIso;
    saveDB(db);
    return (db.sites || []).map((s) => ({ ...s }));
  },

  /* ---------- alerts ---------- */
  async listAlerts() {
    await delay();
    return getDB().alerts.slice(0, 200);
  },

  async ackAlert(id) {
    await delay();
    const db = getDB();
    const a = (db.alerts || []).find((x) => String(x.id) === String(id) || String(x._id) === String(id));
    if (a) {
      a.acknowledged = true;
      a.ackBy = 'admin';
      a.ackAt = new Date().toISOString();
    }
    saveDB(db);
    return a || { ok: true };
  },

  async ackAllAlerts(siteId) {
    await delay();
    const db = getDB();
    (db.alerts || []).forEach((a) => {
      if (!siteId || a.siteId === siteId) {
        a.acknowledged = true;
        a.ackBy = 'admin';
        a.ackAt = new Date().toISOString();
      }
    });
    saveDB(db);
    return { ok: true };
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
  async getReportData({ siteId, from, to, interval = 15 }) {
    await delay();
    const db = getDB();
    const site = findSite(db, siteId);
    if (!site) throw new Error('Site not found.');

    const readings = [];
    const intervalMins = [1, 5, 10, 15].includes(Number(interval))
      ? Number(interval)
      : (Number(interval) || 15);
    const step = intervalMins * 60 * 1000;

    // Safety limit: avoid browser freeze if an extremely long range is selected with 1-min interval
    const maxSteps = 10000;
    const requestedSteps = Math.floor((to - from) / step);
    const actualStep = requestedSteps > maxSteps ? Math.ceil((to - from) / maxSteps) : step;

    for (let t = from; t <= to; t += actualStep) {
      site.params.forEach((p) => {
        const def = p.limit || 100;
        const val = p.key === 'pH'
          ? +(7.0 + Math.sin(t / 3.6e6) * 0.6 + (Math.random() - 0.5) * 0.3).toFixed(2)
          : +(def * (0.5 + Math.random() * 0.35)).toFixed(2);
        readings.push({ siteId, param: p.key, value: val, ts: t });
      });
    }
    return { readings, interval: intervalMins };
  },

  /* ---------- users & creds ---------- */
  async listUsers() {
    await delay();
    return getDB().users.slice();
  },

  async getCreds() {
    await delay();
    const db = getDB();
    const c = db.creds || {};
    return {
      ...OFFICIAL_CREDS,
      ...c,
      adminPass: c.adminPass || OFFICIAL_CREDS.adminPass,
      engPass: c.engPass || OFFICIAL_CREDS.engPass,
      engLogin: c.engLogin || OFFICIAL_CREDS.engLogin,
      engName: c.engName || OFFICIAL_CREDS.engName,
      engMobile: c.engMobile || OFFICIAL_CREDS.engMobile,
      salesPass: c.salesPass || OFFICIAL_CREDS.salesPass,
      salesLogin: c.salesLogin || OFFICIAL_CREDS.salesLogin,
      salesName: c.salesName || OFFICIAL_CREDS.salesName,
    };
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

  async createEngineer({ name, login, password, mobile, email }) {
    await delay();
    const db = getDB();
    const cleanLogin = String(login || '').toLowerCase().trim();
    if (!name || !cleanLogin || !password) {
      throw new Error('Name, login username, and password are required.');
    }
    if ((db.users || []).some((u) => String(u.login).toLowerCase().trim() === cleanLogin)) {
      throw new Error(`Login username "${cleanLogin}" is already in use.`);
    }
    const newUser = {
      id: Date.now(),
      name: name.trim(),
      role: 'engineer',
      login: cleanLogin,
      password: String(password),
      mobile: (mobile || '').trim(),
      email: (email || '').trim(),
    };
    db.users = [...(db.users || []), newUser];
    saveDB(db);
    return { ...newUser };
  },

  async deleteUser(id) {
    await delay();
    const db = getDB();
    const target = (db.users || []).find((u) => String(u.id) === String(id));
    if (!target) throw new Error('User not found.');
    if (target.role === 'admin' || target.login === 'admin') {
      throw new Error('Cannot delete primary admin account.');
    }
    db.users = (db.users || []).filter((u) => String(u.id) !== String(id));
    saveDB(db);
    return { ok: true };
  },

  async updateUserPassword(id, newPassword) {
    await delay();
    const db = getDB();
    const target = (db.users || []).find((u) => String(u.id) === String(id));
    if (!target) throw new Error('User not found.');
    target.password = newPassword;
    saveDB(db);
    return { ok: true };
  },

  /* ---------- generic parameter diverter (mock & offline mode) ---------- */
  divertReading(siteId, pidOrParam, value) {
    const db = getDB();
    const site = findSite(db, siteId) || (db.sites && db.sites[0]);
    if (!site) return null;

    const reqUp = String(pidOrParam || '').trim().toUpperCase();
    const p = (site.params || []).find(
      (x) =>
        (x.pid && x.pid.toUpperCase() === reqUp) ||
        (x.key && x.key.toUpperCase() === reqUp) ||
        (x.name && x.name.toUpperCase() === reqUp) ||
        (x.pid && x.pid.toUpperCase().endsWith('-' + reqUp))
    );
    if (!p) return null;

    const numVal = Number(value);
    p.value = numVal;
    p.updatedAt = new Date().toISOString();
    p.lastData = 'just now';
    p.connHrs = 0;
    const hist = Array.isArray(p.history) ? [...p.history] : [];
    hist.push(numVal);
    if (hist.length > 24) hist.shift();
    p.history = hist;

    site.lastData = 'just now';
    site.lastSeenAt = new Date().toISOString();
    site.connectivity = 'live';

    saveDB(db);
    return { ok: true, pid: p.pid, key: p.key, value: numVal };
  },

  /* ---------- simulator (offline push) ---------- */
  pushSimulatedReading(siteId, param, value) {
    return this.divertReading(siteId, param, value);
  },

  /* ---------- live push & CPCB ---------- */
  async liveUnlock(id, password) {
    await delay(150);
    return { ok: true, token: 'mock-live-token', user: id || 'admin' };
  },

  async livePush(payload) {
    await delay(400);
    return {
      ok: true,
      status: 200,
      cpcbStatus: 116,
      cpcbMsg: 'Device is not registered, Please register for the Industry',
      apiUrl: payload.apiUrl || 'https://cems.cpcb.gov.in/v1.0/industry/data',
      stationId: payload.stationId,
      deviceId: payload.deviceId,
      params: (payload.parameters || []).length,
      pushedAt: Date.now(),
      message: 'Successfully transmitted to CPCB (mock)',
    };
  },

  async getCpcbConfig(siteId) {
    await delay(100);
    try {
      const raw = localStorage.getItem('sz_cpcb_mock_' + siteId);
      return raw ? JSON.parse(raw) : { ok: true, config: {} };
    } catch {
      return { ok: true, config: {} };
    }
  },

  async saveCpcbConfig(siteId, config) {
    await delay(100);
    try {
      localStorage.setItem('sz_cpcb_mock_' + siteId, JSON.stringify({ ok: true, config }));
    } catch {}
    return { ok: true };
  },

  /* ---------- reset (dev helper) ---------- */
  reset() {
    localStorage.removeItem(DB_KEY);
    return initDB();
  },
};

export const MOCK_MODE = true;