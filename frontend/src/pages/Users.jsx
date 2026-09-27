import { useData } from '../context/DataContext';
import Panel from '../components/UI/Panel';

const ROLE_COLOR = {
  admin: 'var(--st-purple)',
  engineer: 'var(--st-green)',
  sales: 'var(--accent)',
  industry: 'var(--st-grey)',
};

export default function Users() {
  const { users, sites, creds } = useData();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Users & Engineers</div>
          <div className="page-sub">
            <span>{users.length} accounts</span>
            <span>·</span>
            <span>{sites.length} industry logins</span>
          </div>
        </div>
      </div>

      <Panel title="Access Accounts" body="flush">
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
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.name}</b>
                    {u.role === 'engineer' &&
                      creds?.engName &&
                      creds.engName !== u.name && (
                        <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                          {' '}
                          · shown as {creds.engName}
                        </span>
                      )}
                  </td>
                  <td>
                    <span className="status-pill">
                      <span
                        className="status-dot"
                        style={{ background: ROLE_COLOR[u.role] }}
                      ></span>
                      {u.role}
                    </span>
                  </td>
                  <td className="mono">{u.login}</td>
                  <td className="mono">{u.mobile || '—'}</td>
                </tr>
              ))}

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
                  <td className="mono">{s.id}</td>
                  <td className="mono">{s.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="How accounts work">
        <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.75 }}>
          <p>
            <b style={{ color: 'var(--st-purple)' }}>Admin</b> — full access to
            every site, user management, passwords, parameters, service contracts.
          </p>
          <p style={{ marginTop: 8 }}>
            <b style={{ color: 'var(--st-green)' }}>Service Engineer</b> — on-site
            support. Can manage sites, approve reports, resolve complaints,
            manage service contracts.
          </p>
          <p style={{ marginTop: 8 }}>
            <b style={{ color: 'var(--accent)' }}>Sales</b> — view-only access to
            sites and contracts. Can manage contract renewals but cannot delete
            anything.
          </p>
          <p style={{ marginTop: 8 }}>
            <b>Industry</b> — one account per site. Logs in with the industry
            code and a passcode (default{' '}
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'var(--surface-2)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              1234
            </code>
            ).
          </p>
          <p
            style={{
              marginTop: 16,
              padding: '12px 14px',
              background: 'var(--surface-2)',
              borderLeft: '3px solid var(--st-yellow)',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <b>Note:</b> In this build, credentials are stored in the browser.
            For live deployment, move to server-side auth with hashed passwords.
          </p>
        </div>
      </Panel>
    </>
  );
}