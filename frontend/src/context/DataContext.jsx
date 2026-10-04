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

const DataContext = createContext(null);

/* Must match the flag in AuthContext */
const USE_REAL_BACKEND = true;

function normalizeSite(s) {
  if (!s) return s;
  return {
    ...s,
    params: Array.isArray(s.params)
      ? s.params.map((p) => ({
          ...p,
          key: p.key === 'SO2' ? 'SOX' : p.key,
          name: p.name
            ? String(p.name).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX')
            : (p.key === 'SO2' ? 'SOX' : p.name),
          pid: p.pid ? String(p.pid).replace(/SO2/gi, 'SOX') : p.pid,
        }))
      : s.params,
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
              ? { ...s, connectivity: 'grey', signal: 'grey' }
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
        createSite,
        updateSite,
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