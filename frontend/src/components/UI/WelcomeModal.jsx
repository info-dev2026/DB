import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const AUTO_CLOSE_MS = 7500;   // auto-close after 7.5 seconds

export default function WelcomeModal() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

  /* Show every time an industry user lands on the app */
  useEffect(() => {
    if (!session || session.role !== 'industry' || !session.siteId) {
      setOpen(false);
      return;
    }

    // Small delay so the layout settles first
    const showTimer = setTimeout(() => setOpen(true), 300);

    // Auto-close timer
    const closeTimer = setTimeout(() => setOpen(false), AUTO_CLOSE_MS + 300);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(closeTimer);
    };
  }, [session]);

  if (!open) return null;

  const siteName = session.name || 'Your Site';

  return (
    <div className="welcome-bg" onClick={() => setOpen(false)}>
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-logo-wrap">
          <img
            src="/logo.png"
            alt=""
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        </div>

        <div className="welcome-eyebrow">Welcome to</div>

        <h2 className="welcome-site">{siteName}</h2>

        <div className="welcome-divider"></div>

        <div className="welcome-brand">Saaphzone Technologies</div>

        <button
          className="btn btn-primary welcome-btn"
          onClick={() => setOpen(false)}
          autoFocus
        >
          Continue
        </button>
      </div>
    </div>
  );
}