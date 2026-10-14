import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import ThemeToggle from '../UI/ThemeToggle';
import { fmtTime } from '../../utils/formatters';
import { PARAMS } from '../../utils/cpcb';

const TITLES = {
  '/':            ['Dashboard', 'All connected sites · live status'],
  '/mysite':      ['My Site', 'Live readings & compliance'],
  '/sites':       ['Sites', 'Connected OCEMS sites'],
  '/map':         ['Site Map', 'Geographic overview'],
  '/alerts':      ['Alert Log', 'CPCB automated grading'],
  '/addsite':     ['Add / Edit Sites', 'Register & manage sites'],
  '/params':      ['Parameters', 'Monitoring parameter registry'],
  '/users':       ['Users & Engineers', 'Access management'],
  '/complaints':  ['Complaints', 'Client-raised issues'],
  '/mycomplaints':['My Complaints', 'Issues you raised'],
  '/reports':     ['Reports', 'Generate & download data'],
  '/account':     ['Account', 'Profile & passcode'],
  '/services':    ['Service Contracts', 'DTC · AMC · CMC'],
  '/myservices':  ['My Services / Renewal', 'DTC · AMC · CMC status'],
  '/security':    ['Security / Passwords', 'Credential management'],
  '/live':        ['Live Push', 'CPCB & State Board Telemetry Gateway'],
};

/* Returns the current total param count from the PARAMS registry */
function getParamCount() {
  return Object.keys(PARAMS).length;
}

export default function TopBar({ onMenuClick }) {
  const { session } = useAuth();
  const { sites = [], alerts = [] } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [paramCount, setParamCount] = useState(() => getParamCount());

  /* Clock tick */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* On mount: re-read after a tick so loadCustomParams() has had time to mutate PARAMS */
  useEffect(() => {
    const id = requestAnimationFrame(() => setParamCount(getParamCount()));
    return () => cancelAnimationFrame(id);
  }, []);

  /* Reactively update param count whenever a parameter is added / deleted */
  useEffect(() => {
    const onParamsUpdated = () => setParamCount(getParamCount());
    window.addEventListener('sz-params-updated', onParamsUpdated);
    return () => window.removeEventListener('sz-params-updated', onParamsUpdated);
  }, []);

  /* Total connected parameters across all onboarded sites */
  const totalConnectedParams = useMemo(() => {
    if (sites && sites.length) {
      return sites.reduce((sum, s) => sum + (Array.isArray(s.params) ? s.params.length : 0), 0);
    }
    return paramCount;
  }, [sites, paramCount]);

  const path = location.pathname;
  let [title, sub] = TITLES[path] || ['', ''];
  if (path.startsWith('/sites/') && path !== '/sites') {
    title = 'Site Detail';
    sub = path.slice('/sites/'.length);
  }

  const unread = alerts.filter((a) => !a.acknowledged).length;

  const openSupport = () =>
    window.dispatchEvent(new CustomEvent('open-support'));

  return (
    <header className="topbar">
      <div className="topbar-left">
        {session && (
          <button className="icon-btn topbar-menu" onClick={onMenuClick} aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <div className="topbar-titles">
          <div className="topbar-title">{title}</div>
          {sub && <div className="topbar-sub">{sub}</div>}
        </div>
      </div>

      <div className="topbar-right">
        <span className="topbar-clock">
          {now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          {'  '}
          {fmtTime(now)} IST
        </span>

        {session && (
          <>
            {/* Total Connected Parameters button in top menu */}
            <button
              id="topbar-param-count"
              className="topbar-param-chip"
              onClick={() => navigate((session.role === 'admin' || session.role === 'engineer') ? '/params' : '/sites')}
              title={`${totalConnectedParams} total monitoring parameters connected across ${sites.length} sites — click to view`}
              aria-label="Total parameters connected"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="topbar-param-num">{totalConnectedParams}</span>
              <span className="topbar-param-label">Connected Params</span>
            </button>

            <button
              className="icon-btn"
              title="Alerts"
              onClick={() => navigate('/alerts')}
              aria-label="Alerts"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unread > 0 && (
                <span className="badge-count">{unread > 99 ? '99+' : unread}</span>
              )}
            </button>

            <ThemeToggle />

            <button className="topbar-support" onClick={openSupport}>
              ⚠ Support
            </button>
          </>
        )}
      </div>
    </header>
  );
}