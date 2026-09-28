import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const HINTS = {
  admin: {
    u: 'Admin username', up: 'admin',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your administrator credentials.',
  },
  engineer: {
    u: 'Engineer username', up: 'chandan',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your service engineer credentials.',
  },
  sales: {
    u: 'Sales username', up: 'sales',
    p: 'Password', pp: 'password',
    hint: 'Sign in with your sales credentials.',
  },
  industry: {
    u: 'Industry code', up: 'e.g. TEST_2026',
    p: 'Passcode', pp: 'your passcode',
    hint: 'Sign in with your Industry Code and Passcode. Contact your administrator if you have not received a passcode.',
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

          <div className="gate-err">{err}</div>

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