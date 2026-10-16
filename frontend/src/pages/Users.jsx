import { useState } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../context/DataContext';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';

const ROLE_COLOR = {
  admin: 'var(--st-purple)',
  engineer: 'var(--st-green)',
  sales: 'var(--accent)',
  industry: 'var(--st-grey)',
};

export default function Users() {
  const { users, sites, addEngineer, deleteUser, updateUserPassword } = useData();

  /* Add Engineer form state */
  const [showAddForm, setShowAddForm] = useState(true);
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [creating, setCreating] = useState(false);

  /* Reset Password modal state */
  const [resetModalUser, setResetModalUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  /* Filter engineers vs admin/sales */
  const engineers = (users || []).filter((u) => u.role === 'engineer');
  const otherUsers = (users || []).filter((u) => u.role !== 'engineer');

  const handleCreateEngineer = async (e) => {
    e?.preventDefault();
    if (!name.trim() || !login.trim() || !password) {
      toast.error('Please enter Name, Login Username, and Password.');
      return;
    }
    if (login.trim().length < 3) {
      toast.error('Login username must be at least 3 characters.');
      return;
    }
    if (password.length < 4) {
      toast.error('Password must be at least 4 characters.');
      return;
    }

    setCreating(true);
    try {
      await addEngineer({
        name: name.trim(),
        login: login.trim().toLowerCase(),
        password,
        mobile: mobile.trim(),
        email: email.trim(),
      });
      toast.success(`Engineer account "${login.trim().toLowerCase()}" created successfully!`);
      setName('');
      setLogin('');
      setPassword('');
      setMobile('');
      setEmail('');
    } catch (err) {
      toast.error(err.message || 'Failed to create engineer account.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (u) => {
    if (u.role === 'admin' || u.login === 'admin') {
      toast.error('Primary administrator account cannot be deleted.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete engineer "${u.name}" (${u.login})? This will revoke their portal access immediately.`)) {
      return;
    }
    try {
      await deleteUser(u.id);
      toast.success(`Engineer account "${u.login}" deleted.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete user.');
    }
  };

  const handleResetPassword = async (e) => {
    e?.preventDefault();
    if (!newPassword || newPassword.length < 4) {
      toast.error('New password must be at least 4 characters.');
      return;
    }
    setResetting(true);
    try {
      await updateUserPassword(resetModalUser.id, newPassword);
      toast.success(`Password updated for ${resetModalUser.name} (${resetModalUser.login})`);
      setResetModalUser(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err.message || 'Failed to update password.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Users &amp; Engineers</div>
          <div className="page-sub">
            <span>{engineers.length} service engineers</span>
            <span>·</span>
            <span>{users.length} total accounts</span>
            <span>·</span>
            <span>{sites.length} industry logins</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddForm((prev) => !prev)}
          >
            {showAddForm ? 'Hide Form' : '➕ Add Engineer'}
          </button>
        </div>
      </div>

      {/* ================= SECTION: ADD ENGINEER CREDENTIALS ================= */}
      {showAddForm && (
        <Panel
          title="➕ Add Service Engineer Login Credentials"
          hint="Create accounts for company engineers with custom username & password"
        >
          <form onSubmit={handleCreateEngineer}>
            <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--ink-2)' }}>
              Engineers added here can sign in at the login screen with their username and password to manage sites, alerts, parameters, and service contracts. (Live Push access is restricted to Administrators).
            </div>

            <div className="form-grid">
              <div className="fg">
                <label htmlFor="eng-name">
                  Engineer Full Name <span className="req">*</span>
                </label>
                <input
                  id="eng-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  required
                />
                <div className="hint">Display name shown across the portal and reports</div>
              </div>

              <div className="fg">
                <label htmlFor="eng-login">
                  Login Username <span className="req">*</span>
                </label>
                <input
                  id="eng-login"
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  placeholder="e.g. rahul"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  required
                />
                <div className="hint">Unique username for login (lowercase, no spaces)</div>
              </div>

              <div className="fg">
                <label htmlFor="eng-pass" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    Login Password <span className="req">*</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowPass((p) => !p)}
                    style={{ padding: '0 4px', fontSize: 11, height: 20 }}
                  >
                    {showPass ? 'Hide' : 'Show'}
                  </button>
                </label>
                <input
                  id="eng-pass"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 4 characters"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  required
                />
                <div className="hint">Password used by this engineer to log in</div>
              </div>

              <div className="fg">
                <label htmlFor="eng-mobile">Mobile Number (Optional)</label>
                <input
                  id="eng-mobile"
                  type="text"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="e.g. 9818536015"
                />
                <div className="hint">Contact mobile for on-site engineer assignments</div>
              </div>

              <div className="fg fg-wide">
                <label htmlFor="eng-email">Email Address (Optional)</label>
                <input
                  id="eng-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. rahul@saaphzone.com"
                />
                <div className="hint">Optional notifications &amp; report alerts email</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating}
              >
                {creating ? 'Creating Account…' : '💾 Create Engineer Account'}
              </button>
            </div>
          </form>
        </Panel>
      )}

      {/* ================= SECTION: SERVICE ENGINEERS TABLE ================= */}
      <Panel
        title={`Service Engineers (${engineers.length})`}
        hint="Company engineers with access to site telemetry, complaints, parameters and reports"
        body="flush"
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Login Username</th>
                <th>Mobile</th>
                <th>Email</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {engineers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-3)' }}>
                    No engineer accounts found. Use the form above to add engineers for your company.
                  </td>
                </tr>
              ) : (
                engineers.map((u) => (
                  <tr key={u.id || u.login}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>👷‍♂️</span>
                        <b>{u.name}</b>
                      </div>
                    </td>
                    <td>
                      <span className="status-pill">
                        <span
                          className="status-dot"
                          style={{ background: ROLE_COLOR.engineer }}
                        ></span>
                        Service Engineer
                      </span>
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>{u.login}</td>
                    <td className="mono">{u.mobile || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Reset password for this engineer"
                          onClick={() => {
                            setResetModalUser(u);
                            setNewPassword('');
                          }}
                        >
                          🔑 Reset Password
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Delete engineer account"
                          style={{ color: 'var(--st-red)' }}
                          onClick={() => handleDelete(u)}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ================= SECTION: SYSTEM & ADMIN ACCOUNTS ================= */}
      <Panel title="System &amp; Administration Accounts" body="flush">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Login</th>
                <th>Mobile</th>
              </tr>
            </thead>
            <tbody>
              {otherUsers.map((u) => (
                <tr key={u.id || u.login}>
                  <td>
                    <b>{u.name}</b>
                  </td>
                  <td>
                    <span className="status-pill">
                      <span
                        className="status-dot"
                        style={{ background: ROLE_COLOR[u.role] || 'var(--ink-4)' }}
                      ></span>
                      {u.role}
                    </span>
                  </td>
                  <td className="mono">{u.login}</td>
                  <td className="mono">{u.mobile || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ================= SECTION: INDUSTRY SITE LOGINS ================= */}
      <Panel title="Industry Site Logins" body="flush">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Industry Name</th>
                <th>Role</th>
                <th>Site Code (Login)</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} style={{ background: 'var(--surface-2)' }}>
                  <td>{s.name}</td>
                  <td>
                    <span className="status-pill">
                      <span
                        className="status-dot"
                        style={{ background: ROLE_COLOR.industry }}
                      ></span>
                      industry
                    </span>
                  </td>
                  <td className="mono">{s.id || s.siteCode}</td>
                  <td className="mono">{s.phone || s.contact || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ================= RESET PASSWORD MODAL ================= */}
      <Modal
        open={Boolean(resetModalUser)}
        title={`Reset Password: ${resetModalUser?.name} (${resetModalUser?.login})`}
        onClose={() => setResetModalUser(null)}
        width={460}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setResetModalUser(null)}
              disabled={resetting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleResetPassword}
              disabled={resetting || !newPassword}
            >
              {resetting ? 'Updating…' : 'Save New Password'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>
            Enter a new password for engineer <b>{resetModalUser?.name}</b> (login ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{resetModalUser?.login}</code>).
          </p>
          <div className="fg">
            <label htmlFor="reset-new-pass">
              New Password <span className="req">*</span>
            </label>
            <input
              id="reset-new-pass"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 4 characters"
              style={{ fontFamily: 'var(--font-mono)' }}
              autoFocus
            />
          </div>
        </div>
      </Modal>

      {/* ================= ROLE DOCUMENTATION ================= */}
      <Panel title="Role Permissions Overview">
        <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.75 }}>
          <p>
            <b style={{ color: 'var(--st-purple)' }}>Admin</b> — full access across the entire platform, including Live Push (CPCB gateway), adding/deleting engineers, database settings, and system parameters.
          </p>
          <p style={{ marginTop: 8 }}>
            <b style={{ color: 'var(--st-green)' }}>Service Engineer</b> — on-site support. Can manage sites, parameters, approve reports, resolve complaints, and manage service contracts. <i>(Live Push gateway is hidden and restricted to Administrators).</i>
          </p>
          <p style={{ marginTop: 8 }}>
            <b style={{ color: 'var(--accent)' }}>Sales</b> — view-only access to sites and contracts. Can manage contract renewals.
          </p>
          <p style={{ marginTop: 8 }}>
            <b>Industry</b> — one account per site. Logs in with the industry code and a passcode.
          </p>
        </div>
      </Panel>
    </>
  );
}