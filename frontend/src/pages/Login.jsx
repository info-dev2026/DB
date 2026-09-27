import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getApiBase, setApiBase } from '../api/api';
import toast from 'react-hot-toast';

const HINTS = {
  admin: {
    u: 'Admin username', up: 'admin',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your administrator credentials (demo: admin / password or admin123).',
  },
  engineer: {
    u: 'Engineer username', up: 'chandan',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your service engineer credentials (demo: chandan / password).',
  },
  sales: {
    u: 'Sales username', up: 'sales',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your sales credentials (demo: sales / password).',
  },
  industry: {
    u: 'Industry code', up: 'e.g. TEST_2026',
    p: 'Passcode', pp: 'your passcode (default: 1234)',
    hint: 'Sign in with your Industry Code and Passcode (demo: TEST_2026 / 1234).',
  },
};

const ROLES = ['admin', 'engineer', 'sales', 'industry'];

export default function Login() {
  const { login } = useAuth();
  const [role, setRole] = useState('industry');
  const [loginVal, setLoginVal] = useState('');
  const [passVal, setPassVal] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState(getApiBase());

  const saveServerUrl = (e) => {
    e?.preventDefault();
    const updated = setApiBase(customApiUrl);
    setCustomApiUrl(updated);
    setErr('');
    toast.success('Backend URL updated: ' + updated);
  };

  const c = HINTS[role];

  const switchRole = (r) => {
    setRole(r);
    setLoginVal('');
    setPassVal('');
    setErr('');
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!loginVal || !passVal) {
      setErr('Enter both fields.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const user = await login(role, loginVal, passVal);
      toast.success('Welcome, ' + user.name);
    } catch (e2) {
      setErr(e2.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate-wrap">
      <div className="gate-card">
        {/* Brand */}
        <div className="gate-brand">
          <div className="gate-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="gate-title">Saaphzone OCEMS</div>
            <div className="gate-sub">Real-Time Continuous Emission Monitoring System</div>
          </div>
        </div>

        {/* Role tabs */}
        <div className="role-tabs">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className={'role-tab' + (role === r ? ' active' : '')}
              onClick={() => switchRole(r)}
            >
              {r === 'admin' ? 'Admin' :
               r === 'engineer' ? 'Engineer' :
               r === 'sales' ? 'Sales' : 'Industry'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={submit} className="gate-form">
          <div className="fg">
            <label>{c.u}</label>
            <input
              value={loginVal}
              onChange={(e) => setLoginVal(e.target.value)}
              placeholder={c.up}
              autoComplete="off"
              autoFocus
            />
          </div>

          <div className="fg" style={{ marginBottom: 16 }}>
            <label>{c.p}</label>
            <input
              type="password"
              value={passVal}
              onChange={(e) => setPassVal(e.target.value)}
              placeholder={c.pp}
            />
          </div>

          {err && (
            <div className="gate-err" style={{ marginBottom: 12 }}>
              <div>{err}</div>
              <button
                type="button"
                onClick={() => setShowServerConfig(!showServerConfig)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--brand, #00d284)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 0',
                  textDecoration: 'underline',
                  display: 'inline-block',
                }}
              >
                {showServerConfig ? 'Hide Server Settings' : 'Configure Backend API URL'}
              </button>
            </div>
          )}

          {showServerConfig && (
            <div
              style={{
                background: 'var(--bg-2, #18202f)',
                padding: '12px 14px',
                borderRadius: 8,
                marginBottom: 16,
                border: '1px solid var(--border-2, #26334d)',
              }}
            >
              <label style={{ fontSize: 11, color: 'var(--ink-2, #a0aec0)', display: 'block', marginBottom: 4 }}>
                Backend API URL (Render / Railway / Tunnel / VPS):
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={customApiUrl}
                  onChange={(e) => setCustomApiUrl(e.target.value)}
                  placeholder="https://your-backend.onrender.com/api/portal"
                  style={{ fontSize: 12, flex: 1, padding: '6px 8px' }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={saveServerUrl}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Save URL
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={busy}
            style={{ marginTop: 4 }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="gate-hint">{c.hint}</div>

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowServerConfig((prev) => !prev)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--brand, #00d284)',
                cursor: 'pointer',
                fontSize: 11,
                textDecoration: 'underline',
                opacity: 0.85,
              }}
            >
              {showServerConfig ? '▲ Hide Server Settings' : '⚙️ Configure Backend API URL'}
            </button>
          </div>

          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--border-2)',
              fontSize: 11,
              color: 'var(--ink-3)',
              textAlign: 'center',
            }}
          >
            Saaphzone Technologies · Industrial Compliance Suite · v3.0
          </div>
        </form>
      </div>
    </div>
  );
}