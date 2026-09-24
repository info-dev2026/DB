import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

/* ---------------- Icons ---------------- */
const Icon = {
  Dashboard: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Sites: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
    </svg>
  ),
  Map: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  Alerts: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Reports: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /><line x1="9" y1="11" x2="13" y2="11" />
    </svg>
  ),
  Services: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Complaints: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  Users: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Params: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Security: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  Account: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  AddSite: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  MySite: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  Manage: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  Chevron: ({ open }) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{
        transition: 'transform 150ms ease',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      }}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  ),
  Logout: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
};

/* ==========================================================
   NAV DEFINITION
   ========================================================== */
function navFor(role) {
  if (role === 'admin') return [
    { type: 'link',  to: '/',         label: 'Dashboard', icon: 'Dashboard', exact: true },
    { type: 'link',  to: '/sites',    label: 'Sites',     icon: 'Sites' },
    { type: 'link',  to: '/map',      label: 'Map',       icon: 'Map' },
    { type: 'link',  to: '/alerts',   label: 'Alerts',    icon: 'Alerts', badge: 'alerts' },

    { type: 'sep', label: 'Operations' },
    {
      type: 'group', key: 'services', label: 'Service Contracts', icon: 'Services',
      children: [
        { to: '/services', label: 'All Industries' },
      ],
    },
    {
      type: 'group', key: 'complaints', label: 'Complaints', icon: 'Complaints',
      children: [
        { to: '/complaints', label: 'All Complaints' },
        { to: '/complaints?status=open', label: 'Open' },
        { to: '/complaints?status=progress', label: 'In Progress' },
        { to: '/complaints?status=resolved', label: 'Resolved' },
      ],
    },
    {
      type: 'group', key: 'reports', label: 'Reports', icon: 'Reports',
      children: [
        { to: '/reports', label: 'Generate Report' },
        { to: '/reports?tab=history', label: 'History' },
      ],
    },

   { type: 'sep', label: 'Administration' },
{
  type: 'group', key: 'sites', label: 'Sites', icon: 'Sites',
  children: [
    { to: '/addsite', label: 'All Sites' },
    { to: '/addsite?action=new', label: 'Register New Site' },
  ],
},
{ type: 'link',  to: '/params',   label: 'Parameters', icon: 'Params' },
{
  type: 'group', key: 'users', label: 'Users & Engineers', icon: 'Users',
  children: [
    { to: '/users', label: 'All Accounts' },
    { to: '/security', label: 'Passwords' },
  ],
},
{ type: 'link', to: '/live', label: 'Live', icon: 'Alerts' },
  ];

  if (role === 'engineer') return [
    { type: 'link',  to: '/',         label: 'Dashboard', icon: 'Dashboard', exact: true },
    { type: 'link',  to: '/sites',    label: 'Sites',     icon: 'Sites' },
    { type: 'link',  to: '/map',      label: 'Map',       icon: 'Map' },
    { type: 'link',  to: '/alerts',   label: 'Alerts',    icon: 'Alerts', badge: 'alerts' },

    { type: 'sep', label: 'Work' },
    { type: 'link',  to: '/addsite',   label: 'Add / Edit Sites', icon: 'AddSite' },
    {
      type: 'group', key: 'svc', label: 'Service Contracts', icon: 'Services',
      children: [
        { to: '/services', label: 'All Industries' },
        { to: '/services?tab=renewals', label: 'Renewals' },
      ],
    },
    {
      type: 'group', key: 'comp', label: 'Complaints', icon: 'Complaints',
      children: [
        { to: '/complaints', label: 'All Complaints' },
        { to: '/complaints?status=open', label: 'Open' },
        { to: '/complaints?status=progress', label: 'In Progress' },
        { to: '/complaints?status=resolved', label: 'Resolved' },
      ],
    },
    {
      type: 'group', key: 'rep', label: 'Reports', icon: 'Reports',
      children: [
        { to: '/reports', label: 'Generate Report' },
        { to: '/reports?tab=history', label: 'History' },
      ],
    },
  ];

  if (role === 'sales') return [
    { type: 'link',  to: '/',         label: 'Dashboard', icon: 'Dashboard', exact: true },
    { type: 'link',  to: '/sites',    label: 'Sites',     icon: 'Sites' },
    { type: 'link',  to: '/map',      label: 'Map',       icon: 'Map' },

    { type: 'sep', label: 'Service (view)' },
    {
      type: 'group', key: 'svc', label: 'Service Contracts', icon: 'Services',
      children: [
        { to: '/services', label: 'All Industries' },
      ],
    },
    { type: 'link',  to: '/complaints', label: 'Complaints', icon: 'Complaints' },
  ];

  /* industry — includes Alerts for own site only */
  return [
    { type: 'link',  to: '/mysite',     label: 'My Site',      icon: 'MySite' },
    { type: 'link',  to: '/myalerts',   label: 'Alerts',       icon: 'Alerts', badge: 'alerts' },

    { type: 'sep', label: 'Service' },
    {
      type: 'group', key: 'svc', label: 'Services', icon: 'Services',
      children: [
        { to: '/myservices', label: 'My Contracts' },
        { to: '/myservices?tab=renew', label: 'Renew' },
        { to: '/myservices?tab=history', label: 'History' },
      ],
    },
    {
      type: 'group', key: 'rep', label: 'Reports', icon: 'Reports',
      children: [
        { to: '/reports', label: 'Generate Report' },
        { to: '/reports?tab=history', label: 'History' },
      ],
    },
    { type: 'link',  to: '/mycomplaints', label: 'My Complaints', icon: 'Complaints' },

    { type: 'sep', label: 'Account' },
    { type: 'link',  to: '/account',      label: 'Account',        icon: 'Account' },
  ];
}

const ROLE_LABEL = {
  admin: 'Admin Panel',
  engineer: 'Senior Engineer',
  sales: 'Sales Team',
  industry: 'Industry',
};

export default function Sidebar({ open, onClose }) {
  const { session, logout } = useAuth();
  const { alerts } = useData();
  const location = useLocation();

  /* Which groups are expanded */
  const [expanded, setExpanded] = useState({});

  /* Auto-expand groups whose child routes match the current path */
  useEffect(() => {
    if (!session) return;
    const items = navFor(session.role);
    const next = { ...expanded };
    items.forEach((it) => {
      if (it.type === 'group') {
        const matches = it.children.some((c) =>
          location.pathname.startsWith(c.to.split('?')[0])
        );
        if (matches) next[it.key] = true;
      }
    });
    setExpanded(next);
    if (onClose) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, session?.role]);

  if (!session) return null;

  const items = navFor(session.role);

  /* Only count unread alerts the current user is allowed to see */
  const visibleAlerts = session.role === 'industry'
    ? alerts.filter((a) => a.siteId === session.siteId)
    : alerts;
  const unread = visibleAlerts.filter((a) => !a.acknowledged).length;

  const initial = (session.name?.replace(/^(Sh\.|Mr\.|Ms\.|Dr\.|Er\.)\s*/i, '').trim()[0] || 'U').toUpperCase();

  const toggleGroup = (key) => {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  };

  const renderBadge = (node) => {
    if (node.badge === 'alerts' && unread > 0) {
      return <span className="sb-badge">{unread > 99 ? '99+' : unread}</span>;
    }
    return null;
  };

  const isChildActive = (child) => {
    const path = child.to.split('?')[0];
    if (child.to.includes('?')) return false;
    return location.pathname === path;
  };

  const isGroupActive = (group) =>
    group.children.some((c) => location.pathname.startsWith(c.to.split('?')[0]));

  return (
    <>
      {open && <div className="sb-backdrop" onClick={onClose} />}

      <aside className={'sidebar' + (open ? ' open' : '')}>
        {/* Brand */}
        <div className="sb-brand">
          <img
            src="/logo.jpeg"
            alt=""
            className="sb-logo"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
          <div className="sb-brand-text">
            <div className="sb-brand-name">Saaphzone</div>
            <div className="sb-brand-sub">OCEMS Portal</div>
          </div>
        </div>

        {/* Role chip */}
        <div className="sb-role">
          <span className="sb-role-dot"></span>
          <span>{ROLE_LABEL[session.role] || session.role}</span>
        </div>

        {/* Nav */}
        <nav className="sb-nav">
          {items.map((it, i) => {
            if (it.type === 'sep') {
              return <div key={'sep-' + i} className="sb-sec">{it.label}</div>;
            }

            if (it.type === 'link') {
              const I = Icon[it.icon];
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={!!it.exact}
                  className={({ isActive }) => 'sb-item' + (isActive ? ' on' : '')}
                >
                  <span className="sb-ic">{I ? <I /> : null}</span>
                  <span className="sb-label">{it.label}</span>
                  {renderBadge(it)}
                </NavLink>
              );
            }

            if (it.type === 'group') {
              const I = Icon[it.icon];
              const isOpen = !!expanded[it.key];
              const active = isGroupActive(it);
              return (
                <div key={it.key} className="sb-group">
                  <button
                    className={'sb-item sb-group-btn' + (active ? ' has-active' : '') + (isOpen ? ' open' : '')}
                    onClick={() => toggleGroup(it.key)}
                    type="button"
                  >
                    <span className="sb-ic">{I ? <I /> : null}</span>
                    <span className="sb-label">{it.label}</span>
                    <span className="sb-chevron">
                      <Icon.Chevron open={isOpen} />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="sb-children">
                      {it.children.map((c) => {
                        const isActive = isChildActive(c);
                        return (
                          <NavLink
                            key={c.to}
                            to={c.to}
                            className={'sb-child' + (isActive ? ' on' : '')}
                          >
                            <span className="sb-child-dot"></span>
                            <span>{c.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
        </nav>

        {/* Footer / user + logout */}
        <div className="sb-foot">
          <div className="sb-user">
            <span className="sb-avatar">{initial}</span>
            <div className="sb-user-info">
              <div className="sb-user-name">{session.name}</div>
              <div className="sb-user-sub">
                {session.siteId ? session.siteId : ROLE_LABEL[session.role]}
              </div>
            </div>
          </div>
          <button className="sb-logout" onClick={logout} title="Sign out">
            <Icon.Logout />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}