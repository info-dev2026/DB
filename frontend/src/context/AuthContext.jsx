import { createContext, useContext, useState, useEffect } from 'react';
import { mockApi } from '../api/mockApi';
import { api as realApi, getToken, setToken } from '../api/api';

const AuthContext = createContext(null);

/* ============================================================
   Real Backend Mode:
   Always connects to the real MERN backend to fetch authentic data.
   ============================================================ */
export const DEFAULT_USE_REAL_BACKEND = true;
export const USE_REAL_BACKEND = true;

const SESSION_KEY = 'sz_session_v3';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [useRealBackend, setUseRealBackend] = useState(true);

  /* ---- Restore session on boot ---- */
  useEffect(() => {
    try {
      if (useRealBackend) {
        const raw = localStorage.getItem(SESSION_KEY);
        const t = getToken();
        if (raw && t) setSession(JSON.parse(raw));
      } else {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) setSession(JSON.parse(raw));
      }
    } catch {}
  }, [useRealBackend]);

  const persist = (sess) => {
    if (sess) localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    else localStorage.removeItem(SESSION_KEY);
    setSession(sess);
  };

  /* ---- Login to real backend ---- */
  const login = async (role, login, password) => {
    if (useRealBackend) {
      const { user } = await realApi.login(role, login, password);
      persist(user);
      return user;
    } else {
      const { user } = await mockApi.login(role, login, password);
      persist(user);
      return user;
    }
  };

  /* ---- Logout ---- */
  const logout = () => {
    if (useRealBackend) {
      realApi.logout();
      setToken(null);
    }
    persist(null);
  };

  return (
    <AuthContext.Provider value={{ session, login, logout, useRealBackend, setUseRealBackend }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};