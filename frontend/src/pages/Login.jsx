import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getApiBase, setApiBase } from '../api/api';
import toast from 'react-hot-toast';

const HINTS = {
  admin: {
    u: 'Admin username', up: 'admin',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your administrator credentials (demo: admin / password).',
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
    <div className="gate">
      {/* ---------------- LEFT: brand panel ---------------- */}
      <div className="gate-left">
        <div className="gate-left-brand">
          <img
            src="/logo.jpeg"
            alt="Saaphzone"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
          <div>
            <div className="brand-name">Saaphzone</div>
            <div className="brand-sub">OCEMS Portal</div>
          </div>
        </div>

        <div className="gate-left-hero">
          <h2>
            Real-time emission<br />
            &amp; effluent monitoring.
          </h2>
          <p>
            Continuous compliance intelligence across every stack, ETP outlet
            and analyser. CPCB / SPCB compliant · 15-minute automated feed ·
            instant alerts on every channel.
          </p>
        </div>

        <div className="gate-left-meta">
          <div className="m">
            <span className="mv">15 min</span>
            <span>Feed interval</span>
          </div>
          <div className="m">
            <span className="mv">24 × 7</span>
            <span>Monitoring</span>
          </div>
          <div className="m">
            <span className="mv">&lt; 1 sec</span>
            <span>Alert latency</span>
          </div>
        </div>
      </div>

      {/* ---------------- RIGHT: form panel ---------------- */}
      <div className="gate-right">
        <form className="gate-card" onSubmit={submit}>
          <h1>Sign in</h1>
          <p>Access your monitoring dashboard</p>

          <div className="role-tabs">
            {ROLES.map((r) => (
              <div
                key={r}
                className={'role-tab' + (role === r ? ' on' : '')}
                onClick={() => switchRole(r)}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </div>
            ))}
          </div>

          <div className="fg" style={{ marginBottom: 16 }}>
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

          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid var(--border-2)',
              fontSize: 11,
              color: 'var(--ink-3)',
              textAlign: 'center',
            }}
          >
            www.saaphzone.com · Saaphzone Technologies
          </div>
        </form>
      </div>
    </div>
  );
}