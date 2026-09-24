import { createContext, useContext, useState, useEffect } from 'react';
import { mockApi } from '../api/mockApi';
import { api as realApi, getToken, setToken } from '../api/api';

const AuthContext = createContext(null);

/* ============================================================
   Backend Mode Detection:
   - Uses real backend if REACT_APP_USE_REAL_BACKEND === 'true',
     or if REACT_APP_API_BASE is set to a remote server.
   - On deployed domains (like Vercel) without a cloud backend URL,
     automatically defaults to mock mode so the app is immediately usable.
   ============================================================ */
export const DEFAULT_USE_REAL_BACKEND = (() => {
  if (process.env.REACT_APP_USE_REAL_BACKEND === 'true') return true;
  if (process.env.REACT_APP_USE_REAL_BACKEND === 'false') return false;
  if (process.env.REACT_APP_API_BASE && !process.env.REACT_APP_API_BASE.includes('localhost')) {
    return true;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return false;
  }
  return true;
})();

export const USE_REAL_BACKEND = DEFAULT_USE_REAL_BACKEND;

const SESSION_KEY = 'sz_session_v3';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [useRealBackend, setUseRealBackend] = useState(DEFAULT_USE_REAL_BACKEND);

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

  /* ---- Login with smart fallback ---- */
  const login = async (role, login, password) => {
    if (useRealBackend) {
      try {
        const { user } = await realApi.login(role, login, password);
        persist(user);
        return user;
      } catch (err) {
        // If the real backend is unreachable, automatically fall back to mockApi
        if (err.message && err.message.includes('backend not reachable')) {
          try {
            const { user } = await mockApi.login(role, login, password);
            persist(user);
            setUseRealBackend(false);
            return user;
          } catch (mockErr) {
            throw new Error('Backend not reachable. Demo credentials: use admin / password');
          }
        }
        throw err;
      }
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