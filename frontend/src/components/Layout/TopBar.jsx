import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import ThemeToggle from '../UI/ThemeToggle';
import { fmtTime } from '../../utils/formatters';

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
};

export default function TopBar({ onMenuClick }) {
  const { session } = useAuth();
  const { alerts } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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