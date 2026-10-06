import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { mockApi } from '../api/mockApi';
import { api as realApi } from '../api/api';
import { connectSocket, onSocket, disconnectSocket } from '../api/socket';
import { useAuth } from './AuthContext';
import { getCustomParamName, setCustomParamName } from '../utils/cpcb';

const DataContext = createContext(null);

/* Must match the flag in AuthContext */
const USE_REAL_BACKEND = true;

function normalizeSite(s) {
  if (!s) return s;
  const rawParams = Array.isArray(s.params) ? s.params : [];

  const keyCounts = {};
  rawParams.forEach((p) => {
    const k = p.key === 'SO2' ? 'SOX' : p.key;
    keyCounts[k] = (keyCounts[k] || 0) + 1;
  });

  const keyIndices = {};

  return {
    ...s,
    params: rawParams.map((p) => {
      const k = p.key === 'SO2' ? 'SOX' : p.key;
      keyIndices[k] = (keyIndices[k] || 0) + 1;
      const idx = keyIndices[k];
      const hasDuplicates = keyCounts[k] > 1;

      const customName = getCustomParamName(s.id || s.siteCode, p.pid);

      let displayName = customName || p.name;
      if (!displayName || displayName === k || displayName === p.key) {
        if (hasDuplicates) {
          displayName = `${k} #${idx}`;
        } else {
          displayName = p.name || k;
        }
      }

      if (displayName) {
        displayName = String(displayName).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX');
      }

      return {
        ...p,
        key: k,
        name: displayName,
        pid: p.pid ? String(p.pid).replace(/SO2/gi, 'SOX') : p.pid,
      };
    }),
  };
}

function normalizeAlert(a) {
  if (!a) return a;
  return {
    ...a,
    param: a.param === 'SO2' ? 'SOX' : a.param,
    reason: a.reason ? String(a.reason).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX') : a.reason,
  };
}

export function DataProvider({ children }) {
  const { session } = useAuth();
  const [sites, setSites] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [users, setUsers] = useState([]);
  const [creds, setCreds] = useState({});
  const [loading, setLoading] = useState(true);

  /* ============================================================
     LOAD ALL DATA (initial fetch)
     ============================================================ */
  const refreshAll = useCallback(async () => {
    if (!session) return;
    try {
      if (USE_REAL_BACKEND) {
        try {
          const [s, a, c] = await Promise.all([
            realApi.listSites(),
            realApi.listAlerts(),
            realApi.listComplaints(),
          ]);
          setSites((s || []).map(normalizeSite));
          setAlerts((a || []).map(normalizeAlert));
          setComplaints(c);
        } catch (apiErr) {
          console.warn('Real backend fetch failed, falling back to cached/mock data:', apiErr.message);
          const [s, a, c, u, cr] = await Promise.all([
            mockApi.listSites(),
            mockApi.listAlerts(),
            mockApi.listComplaints(),
            mockApi.listUsers(),
            mockApi.getCreds(),
          ]);
          setSites((s || []).map(normalizeSite));
          setAlerts((a || []).map(normalizeAlert));
          setComplaints(c);
          setUsers(u);
          setCreds(cr);
        }
      } else {
        const [s, a, c, u, cr] = await Promise.all([
          mockApi.listSites(),
          mockApi.listAlerts(),
          mockApi.listComplaints(),
          mockApi.listUsers(),
          mockApi.getCreds(),
        ]);
        setSites((s || []).map(normalizeSite));
        setAlerts((a || []).map(normalizeAlert));
        setComplaints(c);
        setUsers(u);
        setCreds(cr);
      }
    } catch (e) {
      console.warn('refreshAll failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 15000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  /* ============================================================
     SOCKET — real-time event listeners (only in real mode)
     ============================================================ */
  useEffect(() => {
    if (!USE_REAL_BACKEND || !session) return;

    connectSocket(session);

    const off = [
      onSocket('alert:new', (a) =>
        setAlerts((prev) => [normalizeAlert(a), ...prev].slice(0, 200))
      ),
      onSocket('alert:ack', (u) =>
        setAlerts((prev) =>
          prev.map((a) =>
            String(a._id) === String(u.id) || String(a.id) === String(u.id)
              ? { ...a, acknowledged: true }
              : a
          )
        )
      ),
      onSocket('alert:ackAll', (data) =>
        setAlerts((prev) =>
          prev.map((a) =>
            !data?.siteId || a.siteId === data.siteId
              ? { ...a, acknowledged: true }
              : a
          )
        )
      ),
      onSocket('telemetry:reading', (r) => {
        if (!r || !r.siteId || !r.pid) return;
        const isNA = r.value === 'NA' || r.value === null || r.value === undefined;
        setSites((prev) =>
          prev.map((s) => {
            if (s.id !== r.siteId && s.siteCode !== r.siteId) return s;

            // Check if there are multiple parameters with the same key on this station
            const paramsWithSameKey = (s.params || []).filter((p) => p.key === r.key);
            const hasMultipleOfKey = paramsWithSameKey.length > 1;

            const updatedParams = (s.params || []).map((p) => {
              const exactPid = p.pid && p.pid.toUpperCase() === r.pid.toUpperCase();
              const normPid =
                p.pid &&
                r.pid &&
                p.pid.toUpperCase().replace(/[^A-Z0-9]/g, '') ===
                  r.pid.toUpperCase().replace(/[^A-Z0-9]/g, '');

              // Suffix or key match is ONLY allowed if there is uniquely 1 parameter of that key on the station!
              const allowFuzzy = !hasMultipleOfKey;
              const suffixMatch = allowFuzzy && p.pid && p.pid.toUpperCase().endsWith('-' + r.pid.toUpperCase());
              const keyMatch = allowFuzzy && p.key === r.key;

              const pidMatch = exactPid || normPid || suffixMatch || keyMatch;
              if (!pidMatch) return p;

              const history = Array.isArray(p.history) ? [...p.history] : [];
              if (!isNA && !isNaN(Number(r.value))) {
                history.push(Number(r.value));
                if (history.length > 24) history.shift();
              }
              return {
                ...p,
                value: isNA ? null : Number(r.value),
                hasReceivedData: !isNA,
                signal: isNA ? 'grey' : (r.signal || p.signal),
                history,
                updatedAt: r.ts || new Date().toISOString(),
                lastData: 'just now',
                connHrs: isNA ? 4 : 0,
              };
            });
            return {
              ...s,
              lastData: 'just now',
              lastSeenAt: r.ts || new Date().toISOString(),
              connectivity: isNA && updatedParams.every((p) => p.signal === 'grey') ? 'grey' : 'live',
              params: updatedParams,
            };
          })
        );
      }),
      onSocket('site:update', (u) =>
        setSites((prev) =>
          prev.map((s) =>
            s.id === u.siteId
              ? normalizeSite({
                  ...s,
                  signal: u.signal,
                  params: u.params || s.params,
                  lastData: u.lastData || s.lastData,
                  lastSeenAt: u.lastSeenAt || s.lastSeenAt,
                })
              : s
          )
        )
      ),
      onSocket('complaint:new', (c) =>
        setComplaints((prev) => [c, ...prev])
      ),
      onSocket('complaint:update', (u) =>
        setComplaints((prev) =>
          prev.map((c) =>
            c._id === u.id ? { ...c, status: u.status } : c
          )
        )
      ),
      onSocket('device:offline', (d) =>
        setSites((prev) =>
          prev.map((s) =>
            s.id === d.siteId
              ? {
                  ...s,
                  connectivity: 'grey',
                  signal: 'grey',
                  params: (s.params || []).map((p) => ({
                    ...p,
                    signal: 'grey',
                  })),
                }
              : s
          )
        )
      ),
      onSocket('device:online', (d) =>
        setSites((prev) =>
          prev.map((s) =>
            s.id === d.siteId ? { ...s, connectivity: 'live' } : s
          )
        )
      ),
    ];

    return () => {
      off.forEach((fn) => fn());
      disconnectSocket();
    };
  }, [session]);

  /* ============================================================
     MUTATIONS
     ============================================================ */
  const api = USE_REAL_BACKEND ? realApi : mockApi;

  const createSite = async (body) => { await api.createSite(body); await refreshAll(); };
  const updateSite = async (id, body) => { await api.updateSite(id, body); await refreshAll(); };
  const updateParam = async (siteId, pid, body) => {
    if (body?.name) {
      setCustomParamName(siteId, pid, body.name);
    }
    // Optimistic local state update
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === siteId || s.siteCode === siteId) {
          return {
            ...s,
            params: (s.params || []).map((p) => {
              if (p.pid === pid || p._id === pid || p.id === pid) {
                return {
                  ...p,
                  ...body,
                  name: body.name || p.name,
                };
              }
              return p;
            }),
          };
        }
        return s;
      })
    );
    try {
      await api.updateParam(siteId, pid, body);
    } catch (err) {
      console.warn('Backend updateParam notice (name persisted locally):', err.message);
    }
    await refreshAll();
  };
  const deleteSite = async (id) => { await api.deleteSite(id); await refreshAll(); };
  const patchSiteState = async (id, patch) => { await api.patchSiteState(id, patch); await refreshAll(); };
  const createComplaint = async (body) => {
    await api.createComplaint(body);
    if (!USE_REAL_BACKEND) await refreshAll();
  };
  const updateComplaint = async (id, patch) => {
    await api.updateComplaint(id, patch);
    if (!USE_REAL_BACKEND) await refreshAll();
  };
  const renewContract = async (body) => { await api.renewContract(body); await refreshAll(); };
  const changePassword = async (body) => {
    if (USE_REAL_BACKEND) return; // not yet implemented on real backend
    await mockApi.changePassword(body);
    await refreshAll();
  };

  const ackAlert = async (id) => {
    setAlerts((prev) =>
      prev.map((a) =>
        String(a.id) === String(id) || String(a._id) === String(id)
          ? { ...a, acknowledged: true, ackAt: new Date().toISOString() }
          : a
      )
    );
    try {
      await api.ackAlert(id);
    } catch (err) {
      console.warn('ackAlert failed:', err.message);
      await refreshAll();
    }
  };

  const ackAllAlerts = async (siteId) => {
    setAlerts((prev) =>
      prev.map((a) =>
        !siteId || a.siteId === siteId
          ? { ...a, acknowledged: true, ackAt: new Date().toISOString() }
          : a
      )
    );
    try {
      await api.ackAllAlerts(siteId);
    } catch (err) {
      console.warn('ackAllAlerts failed:', err.message);
      await refreshAll();
    }
  };

  const syncTelemetry = async (siteId) => {
    try {
      const res = await api.syncTelemetry(siteId);
      if (Array.isArray(res)) {
        setSites(res.map(normalizeSite));
      } else if (res && (res.id || res.siteCode)) {
        setSites((prev) =>
          prev.map((s) => (s.id === (res.id || res.siteCode) ? normalizeSite(res) : s))
        );
      } else {
        await refreshAll();
      }
      return res;
    } catch (err) {
      console.warn('syncTelemetry failed:', err.message);
      await refreshAll();
    }
  };

  const divertParameterReading = async (siteId, pid, value) => {
    try {
      if (USE_REAL_BACKEND) {
        await fetch('/api/datalogger/readings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-key': 'sz_generic_logger_key_2026',
          },
          body: JSON.stringify({
            siteId,
            readings: [{ siteId, pid, value: Number(value), ts: new Date().toISOString() }],
          }),
        });
      } else {
        mockApi.divertReading(siteId, pid, value);
        await refreshAll();
      }
    } catch (err) {
      console.warn('divertParameterReading failed:', err.message);
    }
  };

  return (
    <DataContext.Provider
      value={{
        sites,
        alerts,
        complaints,
        users,
        creds,
        loading,
        refreshAll,
        syncTelemetry,
        divertParameterReading,
        createSite,
        updateSite,
        updateParam,
        deleteSite,
        patchSiteState,
        createComplaint,
        updateComplaint,
        renewContract,
        changePassword,
        ackAlert,
        ackAllAlerts,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
};