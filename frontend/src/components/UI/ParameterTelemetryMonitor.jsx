import { useState, useMemo } from 'react';
import { PARAMS, HEX, SIG_LABEL, triggerReason, isDataReceiving, formatParamValue } from '../../utils/cpcb';
import { getParamTelemetry } from '../../utils/telemetry';
import Panel from './Panel';

export default function ParameterTelemetryMonitor({ site, now, onRefresh, refreshing }) {
  const [filter, setFilter] = useState('all'); // 'all' | 'live' | 'delayed' | 'offline'

  const paramsWithTelemetry = useMemo(() => {
    if (!site?.params) return [];
    return site.params.map((p, idx) => {
      const def = PARAMS[p.key] || {};
      const telemetry = getParamTelemetry(p, site, now);
      const signalHex = HEX[p.signal] || 'var(--ink-3)';
      const rawName = p.name || def.label || p.key;
      const displayName = rawName ? String(rawName).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key);
      const displayKey = p.key === 'SO2' ? 'SOX' : p.key;
      return {
        ...p,
        def,
        telemetry,
        signalHex,
        displayName,
        displayKey,
        idx,
      };
    });
  }, [site, now]);

  const counts = useMemo(() => {
    let live = 0;
    let delayed = 0;
    let offline = 0;
    paramsWithTelemetry.forEach((item) => {
      if (item.telemetry.status === 'live') live++;
      else if (item.telemetry.status === 'delayed') delayed++;
      else offline++;
    });
    return { all: paramsWithTelemetry.length, live, delayed, offline };
  }, [paramsWithTelemetry]);

  const filteredParams = useMemo(() => {
    if (filter === 'all') return paramsWithTelemetry;
    return paramsWithTelemetry.filter((item) => item.telemetry.status === filter);
  }, [paramsWithTelemetry, filter]);

  if (!site || !site.params || site.params.length === 0) {
    return null;
  }

  return (
    <Panel
      title="Parameter Telemetry & Last Data Reception"
      hint="Real-time transmission diagnostics · Reflects each analyzer separately"
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="telemetry-filter-tabs">
            <button
              className={`telemetry-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({counts.all})
            </button>
            <button
              className={`telemetry-tab tab-live ${filter === 'live' ? 'active' : ''}`}
              onClick={() => setFilter('live')}
            >
              <span className="telemetry-live-dot" style={{ width: 6, height: 6 }}></span>
              Live ({counts.live})
            </button>
            {counts.delayed > 0 && (
              <button
                className={`telemetry-tab tab-delayed ${filter === 'delayed' ? 'active' : ''}`}
                onClick={() => setFilter('delayed')}
              >
                <span className="telemetry-delayed-dot" style={{ width: 6, height: 6 }}></span>
                Delayed ({counts.delayed})
              </button>
            )}
            {counts.offline > 0 && (
              <button
                className={`telemetry-tab tab-offline ${filter === 'offline' ? 'active' : ''}`}
                onClick={() => setFilter('offline')}
              >
                <span className="telemetry-offline-dot" style={{ width: 6, height: 6 }}></span>
                Offline ({counts.offline})
              </button>
            )}
          </div>
          {onRefresh && (
            <button
              className="telemetry-sync-btn"
              onClick={onRefresh}
              disabled={refreshing}
              title="Sync telemetry immediately to get latest data"
            >
              <span className={refreshing ? 'spin-icon' : ''}>⚡</span>
              <span>{refreshing ? 'Syncing…' : 'Sync Telemetry'}</span>
            </button>
          )}
        </div>
      }
    >
      <div className="telemetry-grid">
        {filteredParams.map((item) => {
          const { telemetry, def, signalHex, displayName, displayKey } = item;
          const historySlice = (item.history || []).slice(-6);
          const pct = Math.min(
            100,
            (item.value / ((item.limit || def.limit || 100) * 1.6)) * 100
          );

          return (
            <div
              className="telemetry-card"
              key={item.pid || item.key + '-' + item.idx}
              style={{
                borderTop: `3px solid ${telemetry.badgeColor}`,
              }}
            >
              {/* Header */}
              <div className="telemetry-card-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="telemetry-card-title" title={displayName}>
                    {displayName}
                  </div>
                  <div className="telemetry-card-pid">
                    <span className="mono">{displayKey}</span>
                    {item.pid && (
                      <>
                        <span> · </span>
                        <span className="mono">#{item.pid}</span>
                      </>
                    )}
                  </div>
                </div>
                <span
                  className="status-pill"
                  style={{ fontSize: 9.5, padding: '1px 6px', height: 18, borderColor: signalHex }}
                  title={`Signal: ${SIG_LABEL[item.signal] || item.signal}`}
                >
                  <span className={'status-dot ' + item.signal}></span>
                  {triggerReason(item)}
                </span>
              </div>

              {/* Current Value Display */}
              <div className="telemetry-card-body">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="telemetry-card-val">
                    {formatParamValue(item, site)}
                    {isDataReceiving(item, site) && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-3)', marginLeft: 3 }}>
                        {item.unit || def.unit || ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--ink-4)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Lim:{' '}
                    {def.ph
                      ? `${def.min ?? 6.5}–${item.limit || def.limit}`
                      : `≤ ${item.limit || def.limit} ${item.unit || def.unit || ''}`}
                  </div>
                  <div className="gbar" style={{ marginTop: 4, height: 3, maxWidth: 140 }}>
                    <i style={{ width: isDataReceiving(item, site) ? `${pct}%` : '0%', background: isDataReceiving(item, site) ? signalHex : 'var(--st-grey)' }}></i>
                  </div>
                </div>

                {/* Compact History Sparkbars */}
                {historySlice.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 2.5,
                      height: 20,
                      padding: '1px 0',
                    }}
                    title="Last 6 rolling readings"
                  >
                    {historySlice.map((val, hIdx) => {
                      const maxLim = (item.limit || def.limit || 100) * 1.5;
                      const hPct = Math.min(100, Math.max(15, (val / maxLim) * 100));
                      return (
                        <div
                          key={hIdx}
                          style={{
                            width: 3.5,
                            height: `${hPct}%`,
                            background: hIdx === historySlice.length - 1 ? telemetry.badgeColor : 'var(--border)',
                            borderRadius: 1.5,
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Visual "Last Data Received" Container */}
              <div
                className="telemetry-card-reception"
                style={{
                  background: telemetry.bgSoft,
                  border: `1px solid ${telemetry.borderColor}`,
                }}
              >
                <div className="tcr-header">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <span
                      className={
                        telemetry.status === 'live'
                          ? 'telemetry-live-dot'
                          : telemetry.status === 'delayed'
                          ? 'telemetry-delayed-dot'
                          : 'telemetry-offline-dot'
                      }
                      style={{ width: 6, height: 6 }}
                    ></span>
                    <span className="tcr-time" style={{ color: 'var(--ink)' }}>
                      {telemetry.formattedTime}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--ink-3)',
                      }}
                      title={telemetry.formattedFullDate}
                    >
                      {telemetry.dateObj ? telemetry.dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Today'}
                    </span>
                  </div>

                  <span
                    className="badge"
                    style={{
                      background: telemetry.badgeColor,
                      color: '#ffffff',
                      fontSize: 8.5,
                      fontWeight: 700,
                      padding: '1px 5px',
                      lineHeight: 1.2,
                    }}
                  >
                    {telemetry.timeAgoStr.toUpperCase()}
                  </span>
                </div>

                {/* Freshness Bar */}
                <div style={{ marginTop: 2 }}>
                  <div className="tcr-bar">
                    <div
                      className="tcr-bar-fill"
                      style={{
                        width: `${telemetry.freshnessPercent}%`,
                        background: telemetry.badgeColor,
                      }}
                    ></div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 8.5,
                      color: 'var(--ink-4)',
                      marginTop: 2,
                    }}
                  >
                    <span>CPCB 15m window</span>
                    <span style={{ color: telemetry.badgeColor, fontWeight: 600 }}>
                      {telemetry.statusText}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredParams.length === 0 && (
        <div className="empty" style={{ padding: '24px 0' }}>
          No parameters match the “{filter}” filter.
        </div>
      )}
    </Panel>
  );
}
