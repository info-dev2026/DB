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
import { rollup } from '../utils/cpcb';

const DataContext = createContext(null);

/* Simulator tick — only runs in mock mode */
const SIM_MS = 4000;

export function DataProvider({ children }) {
  const { session, useRealBackend } = useAuth();
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
      if (useRealBackend) {
        const [s, a, c] = await Promise.all([
          realApi.listSites(),
          realApi.listAlerts(),
          realApi.listComplaints(),
        ]);
        setSites(s);
        setAlerts(a);
        setComplaints(c);
      } else {
        const [s, a, c, u, cr] = await Promise.all([
          mockApi.listSites(),
          mockApi.listAlerts(),
          mockApi.listComplaints(),
          mockApi.listUsers(),
          mockApi.getCreds(),
        ]);
        setSites(s);
        setAlerts(a);
        setComplaints(c);
        setUsers(u);
        setCreds(cr);
      }
    } catch (e) {
      console.warn('refreshAll failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, [session, useRealBackend]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  /* ============================================================
     SOCKET — real-time event listeners (only in real mode)
     ============================================================ */
  useEffect(() => {
    if (!useRealBackend || !session) return;

    connectSocket(session);

    const off = [
      onSocket('alert:new', (a) =>
        setAlerts((prev) => [a, ...prev].slice(0, 200))
      ),
      onSocket('alert:ack', (u) =>
        setAlerts((prev) =>
          prev.map((a) => (a._id === u.id ? { ...a, acknowledged: true } : a))
        )
      ),
      onSocket('site:update', (u) =>
        setSites((prev) =>
          prev.map((s) =>
            s.id === u.siteId
              ? { ...s, signal: u.signal, params: u.params || s.params }
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
  }, [session, useRealBackend]);

  /* ============================================================
     SIMULATOR — only runs in mock mode
     ============================================================ */
  useEffect(() => {
    if (useRealBackend) return;

    const t = setInterval(() => {
      setSites((prev) => {
        if (!prev.length) return prev;
        return prev.map((site) => {
          if (!site.running || site.connectivity === 'grey') return site;
          const params = site.params.map((p) => {
            const def = p.limit || 100;
            const drift = (Math.random() - 0.48) * def * 0.06;
            let v = +(p.value + drift).toFixed(2);
            if (v < 0) v = 0;
            const hist = [...p.history, v].slice(-24);
            const over = p.key === 'pH' ? v > 8.5 || v < 6.5 : v > p.limit;
            return {
              ...p,
              value: v,
              phVal: p.key === 'pH' ? v : p.phVal,
              history: hist,
              excStreak: over ? (p.excStreak || 0) + 1 : 0,
              yToday: over ? (p.yToday || 0) + 1 : p.yToday,
              y30: over ? (p.y30 || 0) + 1 : p.y30,
            };
          });
          return {
            ...site,
            params,
            signal: rollup(params, 'green', site.enabled),
          };
        });
      });
    }, SIM_MS);

    return () => clearInterval(t);
  }, [useRealBackend]);

  /* ============================================================
     MUTATIONS
     ============================================================ */
  const api = useRealBackend ? realApi : mockApi;

  const createSite = async (body) => { await api.createSite(body); await refreshAll(); };
  const updateSite = async (id, body) => { await api.updateSite(id, body); await refreshAll(); };
  const deleteSite = async (id) => { await api.deleteSite(id); await refreshAll(); };
  const patchSiteState = async (id, patch) => { await api.patchSiteState(id, patch); await refreshAll(); };
  const createComplaint = async (body) => {
    await api.createComplaint(body);
    if (!useRealBackend) await refreshAll();
  };
  const updateComplaint = async (id, patch) => {
    await api.updateComplaint(id, patch);
    if (!useRealBackend) await refreshAll();
  };
  const renewContract = async (body) => { await api.renewContract(body); await refreshAll(); };
  const changePassword = async (body) => {
    if (useRealBackend) return; // not yet implemented on real backend
    await mockApi.changePassword(body);
    await refreshAll();
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
        createSite,
        updateSite,
        deleteSite,
        patchSiteState,
        createComplaint,
        updateComplaint,
        renewContract,
        changePassword,
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