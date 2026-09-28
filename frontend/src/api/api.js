/* ============================================================
   Real API client — talks to the MERN backend
   Base URL: http://localhost:4000/api/portal
   Auto-logout on 401 (expired / invalid JWT)
   ============================================================ */

const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1');

export function sanitizeApiBase(url) {
  if (!url || typeof url !== 'string') return null;
  let clean = url.trim().replace(/\/+$/, '');

  // Strip accidental datalogger paths
  if (clean.includes('/api/datalogger/readings')) {
    clean = clean.replace(/\/api\/datalogger\/readings(\/api\/portal)?/, '/api/portal');
  } else if (clean.includes('/api/datalogger')) {
    clean = clean.replace(/\/api\/datalogger(\/api\/portal)?/, '/api/portal');
  }

  // Ensure it ends with /api/portal
  if (!clean.endsWith('/api/portal')) {
    if (clean.endsWith('/api')) {
      clean = clean + '/portal';
    } else {
      clean = clean + '/api/portal';
    }
  }
  return clean;
}

export function getApiBase() {
  try {
    const custom = localStorage.getItem('sz_api_base');
    if (custom) {
      if (
        custom.includes('datalogger') ||
        custom.includes('localhost') ||
        custom.includes('127.0.0.1')
      ) {
        localStorage.removeItem('sz_api_base');
      } else {
        const sanitized = sanitizeApiBase(custom);
        if (sanitized) return sanitized;
      }
    }
  } catch {}

  if (process.env.REACT_APP_API_BASE) {
    const envClean = sanitizeApiBase(process.env.REACT_APP_API_BASE);
    if (envClean) return envClean;
  }

  return isLocal
    ? 'http://localhost:4000/api/portal'
    : 'https://saaphzone-backend.onrender.com/api/portal';
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
    /* Network-level failure — backend down, blocked by CORS, or unreachable */
    throw new Error('Network error — backend not reachable');
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
    let cleanMsg = 'Invalid server response';
    if (text) {
      const match = text.match(/<pre>([\s\S]*?)<\/pre>/i);
      if (match && match[1]) {
        cleanMsg = match[1].trim();
      } else if (!text.trim().startsWith('<')) {
        cleanMsg = text.trim();
      } else {
        cleanMsg = `HTTP ${res.status}: Server returned an error page`;
      }
    }
    data = { error: cleanMsg };
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