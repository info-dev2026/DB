import { createContext, useContext, useState } from 'react';
import { mockApi } from '../api/mockApi';
import { api as realApi, setToken, getApiBase } from '../api/api';

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
const BACKEND_MODE_KEY = 'sz_backend_mode';

export function AuthProvider({ children }) {
  // Synchronously restore session from localStorage so refresh NEVER redirects to /login
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [useRealBackend, setUseRealBackend] = useState(() => {
    try {
      const savedMode = localStorage.getItem(BACKEND_MODE_KEY);
      if (savedMode === 'real') return true;
      if (savedMode === 'mock') return false;
    } catch {}
    return isLiveBackendAvailable();
  });

  const persist = (sess, isReal = useRealBackend) => {
    try {
      if (sess) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
        localStorage.setItem(BACKEND_MODE_KEY, isReal ? 'real' : 'mock');
      } else {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(BACKEND_MODE_KEY);
      }
    } catch {}
    setSession(sess);
  };

  /* ---- Login with automatic fallback ---- */
  const login = async (role, loginVal, password) => {
    if (useRealBackend) {
      try {
        const { user } = await realApi.login(role, loginVal, password);
        persist(user, true);
        return user;
      } catch (err) {
        // If remote backend is unreachable, seamlessly use local store so user is not blocked
        if (
          err.message &&
          (err.message.includes('Cannot connect to backend') ||
            err.message.includes('Network error'))
        ) {
          try {
            const { user } = await mockApi.login(role, loginVal, password);
            persist(user, false);
            setUseRealBackend(false);
            return user;
          } catch (mockErr) {
            throw new Error(mockErr.message || 'Invalid credentials');
          }
        }
        throw err;
      }
    } else {
      const { user } = await mockApi.login(role, loginVal, password);
      persist(user, false);
      return user;
    }
  };

  /* ---- Logout ---- */
  const logout = () => {
    try {
      if (useRealBackend) {
        realApi.logout();
      }
      setToken(null);
    } catch {}
    persist(null, false);
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