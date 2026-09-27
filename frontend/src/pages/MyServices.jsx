import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import {
  serviceStatus,
  serviceLabel,
  siteServiceAlert,
} from '../utils/serviceHelpers';
import { fmtDay } from '../utils/formatters';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';

export default function MyServices() {
  const { session } = useAuth();
  const { sites, renewContract } = useData();
  const site = sites.find((s) => s.id === session?.siteId);

  const [renewKey, setRenewKey] = useState(null);
  const [chosenTier, setChosenTier] = useState(null);
  const [from, setFrom] = useState('expiry');
  const [busy, setBusy] = useState(false);

  if (!site) return <div className="empty">No site linked to this login.</div>;

  const alert = siteServiceAlert(site);
  const keys = site.services ? Object.keys(site.services) : [];

  const doRenew = async () => {
    if (!chosenTier) {
      toast.error('Pick a package');
      return;
    }
    setBusy(true);
    try {
      await renewContract({ siteId: site.id, key: renewKey, package: chosenTier, from });
      toast.success('Renewed successfully.');
      setRenewKey(null);
      setChosenTier(null);
    } catch (e) {
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const group = renewKey ? renewKey.split('|')[0] : null;
  const tiers = group ? site.catalogue?.[group]?.tiers || [] : [];
  const cur = renewKey ? site.services?.[renewKey] : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">My Services</div>
          <div className="page-sub">
            <span>DTC · AMC · CMC contracts</span>
            <span>·</span>
            <span className="mono">{site.id}</span>
          </div>
        </div>
      </div>

      {/* Expiry banner */}
      {alert && ['expired', 'week', 'd15', 'm1', 'm2'].includes(alert.code) && (
        <div className="service-banner" style={{ borderLeftColor: alert.hex }}>
          <span className="badge" style={{ background: alert.hex }}>
            {alert.label}
          </span>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>
              {alert.type}
              {alert.equip !== '—' ? ' · ' + alert.equip : ''}
            </b>{' '}
            {alert.days < 0
              ? `expired ${Math.abs(alert.days)} days ago`
              : `expires in ${alert.days} days`}
            .
          </div>
        </div>
      )}

      {/* Contract cards */}
      <div className="grid">
        {keys.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1 / -1' }}>
            No contracts set up yet.
          </div>
        ) : (
          keys.map((k) => {
            const c = site.services[k];
            const st = serviceStatus(c);
            const L = serviceLabel(k);
            const pct =
              c && c.expiry && !c.suspended
                ? Math.max(0, Math.min(100, (st.days / 365) * 100))
                : 0;

            return (
              <div
                className={'icard ' + (st.code === 'ok' ? 'green' : 'orange')}
                key={k}
                style={{ cursor: 'default' }}
              >
                <div className="icard-rail"></div>

                <div className="icard-head">
                  <div className="icard-title">
                    <div>
                      <div className="icard-name">
                        {L.type}
                        {L.equip !== '—' ? ' · ' + L.equip : ''}
                      </div>
                      <div className="icard-meta">{L.name}</div>
                    </div>
                    <span className="status-pill">
                      <span className="status-dot" style={{ background: st.hex }}></span>
                      {st.label}
                    </span>
                  </div>
                </div>

                <div className="icard-body">
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                    Valid till
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 17,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {c && c.expiry ? fmtDay(c.expiry) : 'Not set'}
                  </div>
                  <div className="gbar" style={{ marginTop: 10 }}>
                    <i style={{ width: pct + '%', background: st.hex }}></i>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
                    {c.suspended
                      ? 'Contract suspended — contact Saaphzone'
                      : st.days != null
                      ? st.days < 0
                        ? `Expired ${Math.abs(st.days)} days ago`
                        : `${st.days} days remaining`
                      : '—'}
                  </div>
                </div>

                <div className="icard-foot">
                  <span>
                    {(c.history?.length || 0)} renewal
                    {(c.history?.length || 0) === 1 ? '' : 's'}
                  </span>
                  <button
                    className={
                      'btn btn-sm ' +
                      (['expired', 'week', 'd15', 'm1'].includes(st.code)
                        ? 'btn-danger'
                        : 'btn-primary')
                    }
                    onClick={() => {
                      setRenewKey(k);
                      setChosenTier(null);
                    }}
                  >
                    ⟳ Renew
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Renew modal */}
      <Modal
        open={!!renewKey}
        title={renewKey ? `Renew — ${serviceLabel(renewKey).type}` : ''}
        onClose={() => {
          setRenewKey(null);
          setChosenTier(null);
        }}
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setRenewKey(null);
                setChosenTier(null);
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={doRenew}
              disabled={busy || !chosenTier}
            >
              {busy ? 'Renewing…' : 'Confirm renewal'}
            </button>
          </>
        }
      >
        {renewKey && (
          <>
            <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--ink-3)' }}>
              <b style={{ color: 'var(--ink)' }}>
                {serviceLabel(renewKey).type}
                {serviceLabel(renewKey).equip !== '—'
                  ? ' · ' + serviceLabel(renewKey).equip
                  : ''}
              </b>
              {cur && cur.expiry ? ` · valid till ${fmtDay(cur.expiry)}` : ''}
            </div>

            <div className="fg" style={{ marginBottom: 14 }}>
              <label>Select a package</label>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 6,
                }}
              >
                {tiers.map((t) => (
                  <label
                    key={t.id}
                    className={'chk' + (chosenTier === t.id ? ' on' : '')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="radio"
                        name="mp"
                        value={t.id}
                        checked={chosenTier === t.id}
                        onChange={() => setChosenTier(t.id)}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <span>
                        <b>{t.label}</b>
                        <br />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {t.months} months
                        </span>
                      </span>
                    </span>
                    <b style={{ fontFamily: 'var(--font-mono)' }}>
                      ₹{t.price.toLocaleString('en-IN')}
                    </b>
                  </label>
                ))}
              </div>
            </div>

            <div className="fg">
              <label>Renewal starts from</label>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="expiry">
                  Continue from current expiry
                  {cur && cur.expiry ? ` (${fmtDay(cur.expiry)})` : ''}
                </option>
                <option value="today">Start today</option>
              </select>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}