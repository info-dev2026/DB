import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import Panel from '../components/UI/Panel';

export default function Security() {
  const { session } = useAuth();
  const { creds, changePassword } = useData();

  const [adCur, setAdCur] = useState('');
  const [adNew, setAdNew] = useState('');
  const [adConf, setAdConf] = useState('');

  const [enCur, setEnCur] = useState('');
  const [enNew, setEnNew] = useState('');
  const [enConf, setEnConf] = useState('');

  const [slCur, setSlCur] = useState('');
  const [slUser, setSlUser] = useState(creds?.salesLogin || 'sales');
  const [slName, setSlName] = useState(creds?.salesName || 'Sales Team');
  const [slNew, setSlNew] = useState('');

  if (session?.role !== 'admin') {
    return (
      <div className="empty">
        Access restricted. Only the Administrator can manage passwords.
      </div>
    );
  }

  const saveAdmin = async () => {
    if (adNew.length < 4) {
      toast.error('New password must be at least 4 characters.');
      return;
    }
    if (adNew !== adConf) {
      toast.error('Passwords do not match.');
      return;
    }
    try {
      await changePassword({ target: 'admin', current: adCur, new: adNew });
      toast.success('Admin password updated.');
      setAdCur('');
      setAdNew('');
      setAdConf('');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const saveEngineer = async () => {
    if (enNew.length < 4) {
      toast.error('New password must be at least 4 characters.');
      return;
    }
    if (enNew !== enConf) {
      toast.error('Passwords do not match.');
      return;
    }
    try {
      await changePassword({ target: 'engineer', current: enCur, new: enNew });
      toast.success('Service engineer password updated.');
      setEnCur('');
      setEnNew('');
      setEnConf('');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const saveSales = async () => {
    if (!slUser.trim()) {
      toast.error('Username is required.');
      return;
    }
    if (slNew && slNew.length < 4) {
      toast.error('Password must be at least 4 characters.');
      return;
    }
    try {
      await changePassword({
        target: 'sales',
        current: slCur,
        new: slNew || undefined,
        login: slUser.trim(),
        name: slName.trim() || 'Sales Team',
      });
      toast.success('Sales login updated.');
      setSlCur('');
      setSlNew('');
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Security / Passwords</div>
          <div className="page-sub">
            <span>Admin-only credential management</span>
          </div>
        </div>
      </div>

      <Panel title="Authorisation">
        <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.7 }}>
          Only the Administrator can change these credentials. Every change
          must be authorised with the <b>current admin password</b>. Industry
          users manage their own passcode from their Account page.
        </div>
      </Panel>

      {/* -------- Admin password -------- */}
      <Panel
        title="Admin Password"
        hint="Login: admin"
        right={
          <button className="btn btn-primary btn-sm" onClick={saveAdmin}>
            Update password
          </button>
        }
      >
        <div className="form-grid">
          <div className="fg">
            <label>
              Current admin password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={adCur}
              onChange={(e) => setAdCur(e.target.value)}
              placeholder="current admin password"
            />
          </div>
          <div className="fg"></div>
          <div className="fg">
            <label>
              New admin password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={adNew}
              onChange={(e) => setAdNew(e.target.value)}
              placeholder="min 4 characters"
            />
          </div>
          <div className="fg">
            <label>
              Confirm new password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={adConf}
              onChange={(e) => setAdConf(e.target.value)}
            />
          </div>
        </div>
      </Panel>

      {/* -------- Engineer password -------- */}
      <Panel
        title="Service Engineer Password"
        hint={`Login: ${creds?.engLogin || 'chandan'} · ${creds?.engName || 'Sh. Chandan'}`}
        right={
          <button className="btn btn-primary btn-sm" onClick={saveEngineer}>
            Update password
          </button>
        }
      >
        <div className="form-grid">
          <div className="fg">
            <label>
              Current admin password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={enCur}
              onChange={(e) => setEnCur(e.target.value)}
              placeholder="authorise with admin password"
            />
          </div>
          <div className="fg"></div>
          <div className="fg">
            <label>
              New engineer password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={enNew}
              onChange={(e) => setEnNew(e.target.value)}
              placeholder="min 4 characters"
            />
          </div>
          <div className="fg">
            <label>
              Confirm new password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={enConf}
              onChange={(e) => setEnConf(e.target.value)}
            />
          </div>
        </div>
      </Panel>

      {/* -------- Sales login -------- */}
      <Panel
        title="Sales Login"
        hint="View-only service access"
        right={
          <button className="btn btn-primary btn-sm" onClick={saveSales}>
            Save sales login
          </button>
        }
      >
        <div className="form-grid">
          <div className="fg">
            <label>
              Sales username <span className="req">*</span>
            </label>
            <input
              value={slUser}
              onChange={(e) => setSlUser(e.target.value)}
            />
          </div>
          <div className="fg">
            <label>Display name</label>
            <input
              value={slName}
              onChange={(e) => setSlName(e.target.value)}
            />
          </div>
          <div className="fg">
            <label>New sales password</label>
            <input
              type="password"
              value={slNew}
              onChange={(e) => setSlNew(e.target.value)}
              placeholder="leave blank to keep current"
            />
          </div>
          <div className="fg">
            <label>
              Authorise with admin password <span className="req">*</span>
            </label>
            <input
              type="password"
              value={slCur}
              onChange={(e) => setSlCur(e.target.value)}
              placeholder="admin password"
            />
          </div>
        </div>
      </Panel>

      <Panel title="Production notes">
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.7 }}>
          In this build, credentials live in the browser. For live deployment
          on saaphzone.com, move to server-side authentication with hashed
          passwords (bcrypt) and JWT sessions.
        </div>
      </Panel>
    </>
  );
}