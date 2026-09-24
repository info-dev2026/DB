import { createContext, useContext, useState, useEffect } from 'react';
import { mockApi } from '../api/mockApi';
import { api as realApi, getToken, setToken } from '../api/api';

const AuthContext = createContext(null);

/* ============================================================
   🔀 THE FLAG — flip this to `true` to use the real backend.
   While false → mockApi (works without backend)
   When  true → real API + JWT
   ============================================================ */
export const USE_REAL_BACKEND = true;

const SESSION_KEY = 'sz_session_v3';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);

  /* ---- Restore session on boot ---- */
  useEffect(() => {
    try {
      if (USE_REAL_BACKEND) {
        const raw = localStorage.getItem(SESSION_KEY);
        const t = getToken();
        if (raw && t) setSession(JSON.parse(raw));
      } else {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) setSession(JSON.parse(raw));
      }
    } catch {}
  }, []);

  const persist = (sess) => {
    if (sess) localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    else localStorage.removeItem(SESSION_KEY);
    setSession(sess);
  };

  /* ---- Login ---- */
  const login = async (role, login, password) => {
    if (USE_REAL_BACKEND) {
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
    if (USE_REAL_BACKEND) {
      realApi.logout();
      setToken(null);
    }
    persist(null);
  };

  return (
    <AuthContext.Provider value={{ session, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};