/* ============================================================
   Real API client — talks to the MERN backend
   Base URL: http://localhost:4000/api/portal (or custom/env)
   Auto-logout on 401 (expired / invalid JWT)
   ============================================================ */

export function getApiBase() {
  try {
    const custom = localStorage.getItem('sz_api_base');
    if (custom) return custom;
  } catch {}
  return process.env.REACT_APP_API_BASE || 'http://localhost:4000/api/portal';
}

export function setApiBase(url) {
  try {
    if (url && url.trim()) {
      let clean = url.trim().replace(/\/+$/, '');
      if (!clean.endsWith('/api/portal') && !clean.endsWith('/api')) {
        clean = clean + '/api/portal';
      }
      localStorage.setItem('sz_api_base', clean);
      return clean;
    } else {
      localStorage.removeItem('sz_api_base');
    }
  } catch {}
  return getApiBase();
}

export const API_BASE = getApiBase();

const TOKEN_KEY = 'sz_jwt';
const SESSION_KEY = 'sz_session_v3';

/* ---------- Token helpers ---------- */
export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

/* ---------- Auto-logout ---------- */
function forceLogout() {
  setToken(null);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

/* ---------- Core fetch wrapper ---------- */
async function request(path, opts = {}) {
  const headers = {
    Accept: 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };

  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const currentBase = getApiBase();
  let res;
  try {
    res = await fetch(currentBase + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    /* Network-level failure — backend down, blocked, or unreachable */
    throw new Error(
      `Cannot connect to backend at ${currentBase}. Ensure your backend server is running and accessible over HTTPS.`
    );
  }

  /* ---------- Auto-logout on token expiry ---------- */
  if (res.status === 401) {
    forceLogout();
    throw new Error('Session expired. Please sign in again.');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || 'Invalid response' };
  }

  if (!res.ok) {
    const msg = (data && data.error) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/* ---------- Exposed endpoints ---------- */
export const api = {
  /* ---------- auth ---------- */
  async login(role, login, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { role, login, password },
    });
    if (data.token) setToken(data.token);
    return data;
  },
  logout() {
    setToken(null);
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  },

  /* ---------- sites ---------- */
  listSites:      ()          => request('/sites'),
  getSite:        (id)        => request('/sites/' + id),
  createSite:     (body)      => request('/sites', { method: 'POST', body }),
  updateSite:     (id, body)  => request('/sites/' + id, { method: 'PUT', body }),
  patchSiteState: (id, body)  => request('/sites/' + id + '/state', { method: 'PATCH', body }),
  deleteSite:     (id)        => request('/sites/' + id, { method: 'DELETE' }),

  /* ---------- alerts ---------- */
  listAlerts: () => request('/alerts'),
  ackAlert:   (id) => request('/alerts/' + id + '/ack', { method: 'PATCH' }),

  /* ---------- complaints ---------- */
  listComplaints:  ()            => request('/complaints'),
  createComplaint: (body)        => request('/complaints', { method: 'POST', body }),
  updateComplaint: (id, body)    => request('/complaints/' + id, { method: 'PATCH', body }),

  /* ---------- services ---------- */
  listContracts: ()     => request('/services'),
  renewContract: (body) => request('/services/renew', { method: 'POST', body }),

  /* ---------- reports ---------- */
  getReportData: (params) => {
    const qs =
      'siteId=' + encodeURIComponent(params.siteId) +
      '&from=' + encodeURIComponent(params.from) +
      '&to=' + encodeURIComponent(params.to);
    return request('/reports/data?' + qs);
  },

  /* ---------- live push ---------- */
  liveUnlock: (id, password) =>
    request('/live/unlock', {
      method: 'POST',
      body: { id, password },
    }),

  livePush: (payload) =>
    request('/live/push', { method: 'POST', body: payload }),
};