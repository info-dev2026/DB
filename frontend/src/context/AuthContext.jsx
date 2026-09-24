import { createContext, useContext, useState, useEffect } from 'react';
import { mockApi } from '../api/mockApi';
import { api as realApi, getToken, setToken, getApiBase } from '../api/api';

const AuthContext = createContext(null);

export const isLiveBackendAvailable = () => {
  if (typeof window === 'undefined') return true;
  const isLocalHost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (isLocalHost) return true;
  const base = getApiBase();
  return Boolean(base && !base.includes('localhost') && !base.includes('127.0.0.1'));
};

const SESSION_KEY = 'sz_session_v3';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [useRealBackend, setUseRealBackend] = useState(isLiveBackendAvailable());

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

  /* ---- Login with automatic fallback ---- */
  const login = async (role, login, password) => {
    if (useRealBackend) {
      try {
        const { user } = await realApi.login(role, login, password);
        persist(user);
        return user;
      } catch (err) {
        // If remote backend is unreachable, seamlessly use local store so user is not blocked
        if (
          err.message &&
          (err.message.includes('Cannot connect to backend') ||
            err.message.includes('Network error'))
        ) {
          try {
            const { user } = await mockApi.login(role, login, password);
            persist(user);
            setUseRealBackend(false);
            return user;
          } catch (mockErr) {
            throw new Error(mockErr.message || 'Invalid credentials');
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