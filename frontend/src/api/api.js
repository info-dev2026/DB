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
      if (custom.includes('datalogger') || (!isLocal && (custom.includes('localhost') || custom.includes('127.0.0.1')))) {
        localStorage.removeItem('sz_api_base');
      } else {
        const sanitized = sanitizeApiBase(custom);
        if (sanitized) return sanitized;
      }
    }
  } catch {}

  if (isLocal) {
    if (process.env.REACT_APP_API_BASE && !process.env.REACT_APP_API_BASE.includes('render.com')) {
      const envClean = sanitizeApiBase(process.env.REACT_APP_API_BASE);
      if (envClean) return envClean;
    }
    return 'http://localhost:4000/api/portal';
  }

  if (process.env.REACT_APP_API_BASE) {
    const envClean = sanitizeApiBase(process.env.REACT_APP_API_BASE);
    if (envClean) return envClean;
  }

  return 'https://saaphzone-backend.onrender.com/api/portal';
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
  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/live')) {
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
  updateParam:    async function (siteId, pid, body) {
    try {
      return await request('/sites/' + siteId + '/params/' + encodeURIComponent(pid), { method: 'PATCH', body });
    } catch (err) {
      if (err.message && (err.message.includes('404') || err.message.includes('Not found') || err.message.includes('Cannot PATCH'))) {
        try {
          const site = await this.getSite(siteId);
          if (site && Array.isArray(site.params)) {
            const updatedParams = site.params.map((p) => {
              if (p.pid === pid || p._id === pid || p.id === pid) {
                return { ...p, ...body };
              }
              return p;
            });
            return await this.updateSite(siteId, { ...site, params: updatedParams });
          }
        } catch (fbErr) {
          console.warn('Fallback updateSite failed:', fbErr.message);
        }
      }
      throw err;
    }
  },
  patchSiteState: (id, body)  => request('/sites/' + id + '/state', { method: 'PATCH', body }),
  deleteSite:     (id)        => request('/sites/' + id, { method: 'DELETE' }),
  getNextParamId: (count = 1) => request('/sites/next-param-id?count=' + count),
  syncTelemetry:  async (id)  => {
    try {
      await request('/sites/' + id + '/sync', { method: 'POST' });
    } catch {}
    return request('/sites');
  },

  /* ---------- alerts ---------- */
  listAlerts:   () => request('/alerts'),
  ackAlert:     (id) => request('/alerts/' + id + '/ack', { method: 'PATCH' }),
  ackAllAlerts: () => request('/alerts/ack-all', { method: 'PATCH' }),

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

  livePush: async (payload) => {
    // 1. ALWAYS prioritize India Edge Gateway (Mumbai bom1) to guarantee <500ms CPCB connectivity
    // and prevent 502 Bad Gateway timeouts caused by foreign datacenter IP blocks.
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    const targetUrl = isProdBrowser
      ? '/api/live-push'
      : 'https://dashboard.saaphzone.com/api/live-push';

    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, error: text || ('HTTP ' + res.status) };
      }

      // Return valid structured response (whether ok: true or CPCB error status)
      if (data && (data.ok !== undefined || data.cpcbMsg || data.msg || data.error)) {
        return data;
      }

      if (!res.ok) {
        throw new Error((data && (data.error || data.cpcbMsg)) || ('HTTP ' + res.status));
      }
      return data;
    } catch (err) {
      // If direct call to edge gateway had an issue, fallback to backend request
      try {
        return await request('/live/push', { method: 'POST', body: payload });
      } catch (backendErr) {
        throw new Error(err.message || backendErr.message || 'Transmission failed');
      }
    }
  },

  /* ---------- Multi-Board Configuration (CPCB + State SPCBs) ---------- */
  getBoardConfigs: async (siteId) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser) {
      try {
        const res = await fetch(`/api/board-config?siteId=${encodeURIComponent(siteId)}`);
        const json = await res.json();
        if (json && json.ok) return json;
      } catch (e) {}
    }
    return request('/live/boards/' + encodeURIComponent(siteId)).catch(() => ({ ok: false, boards: [] }));
  },

  saveBoardConfig: async (siteId, config) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser) {
      try {
        const res = await fetch('/api/board-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId, ...config }),
        });
        const json = await res.json();
        if (json && json.ok) return json;
      } catch (e) {}
    }
    return request('/live/boards/' + encodeURIComponent(siteId), {
      method: 'POST',
      body: config,
    }).catch(() => ({ ok: false }));
  },

  triggerAutoPushNow: async (siteId = null, boardCode = null) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser && !siteId) {
      // In browser, trigger cloud edge relay or backend
      try {
        const res = await fetch('/api/live-push');
        const json = await res.json();
        if (json && json.ok) return json;
      } catch (e) {}
    }
    return request('/live/autopush/trigger', {
      method: 'POST',
      body: { siteId, boardCode },
    }).catch(() => ({ ok: false }));
  },

  getAllBoardConfigs: async () => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser) {
      try {
        const res = await fetch('/api/board-config?all=true');
        const json = await res.json();
        if (json && json.ok) return json;
      } catch (e) {}
    }
    return request('/live/autopush/status').catch(() => ({ ok: false, configs: [] }));
  },

  getCpcbConfig: (siteId) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser) {
      return fetch(`/api/board-config?siteId=${encodeURIComponent(siteId)}`)
        .then((r) => r.json())
        .catch(() => ({ ok: false }));
    }
    return request('/live/config/' + encodeURIComponent(siteId)).catch(() => ({ ok: false }));
  },

  saveCpcbConfig: (siteId, config) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser) {
      return fetch('/api/board-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, ...config, boardCode: 'CPCB' }),
      })
        .then((r) => r.json())
        .catch(() => ({ ok: false }));
    }
    return request('/live/config/' + encodeURIComponent(siteId), {
      method: 'POST',
      body: config,
    }).catch(() => ({ ok: false }));
  },

  previewCpcb: async (payload) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    const targetUrl = isProdBrowser ? '/api/live-push' : (getApiBase() + '/live/push');
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, dryRun: true }),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { ok: false, error: text };
      }
    } catch (err) {
      if (!isProdBrowser) {
        return request('/live/preview', { method: 'POST', body: payload });
      }
      throw err;
    }
  },

  /* ---------- Regulatory 24/7 Cloud Automated Push ---------- */
  getAutoPushStatus: () =>
    request('/live/autopush/status').catch(() => ({ ok: false })),

  toggleAutoPushSite: async (siteId, enabled, boardCode) => {
    const isProdBrowser = typeof window !== 'undefined' && !isLocal;
    if (isProdBrowser) {
      try {
        const res = await fetch('/api/board-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId,
            boardCode: boardCode || 'ALL',
            autoPush: Boolean(enabled),
            action: enabled ? 'start' : 'stop',
          }),
        });
        const json = await res.json();
        if (json && json.ok) return json;
      } catch (e) {}
    }
    return request('/live/autopush/toggle/' + encodeURIComponent(siteId), {
      method: 'POST',
      body: { enabled, boardCode, action: enabled ? 'start' : 'stop' },
    }).catch(() => ({ ok: false }));
  },

  getAutoPushHistory: () =>
    request('/live/autopush/history').catch(() => ({ ok: false, history: [] })),
};