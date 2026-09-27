import { useState, useMemo, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { HEX, SIG_LABEL, PARAMS } from '../utils/cpcb';
import { api } from '../api/api';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';
import toast from 'react-hot-toast';

/* ============================================================
   State boards — only code, name and portal URL
   (no push endpoints — those go through the backend)
   ============================================================ */
const BOARDS = [
  { code: 'CPCB',   name: 'Central Pollution Control Board',        url: 'https://cpcb.nic.in/' },
  { code: 'DPCC',   name: 'Delhi Pollution Control Committee',      url: 'https://www.dpcc.delhigovt.nic.in/' },
  { code: 'HSPCB',  name: 'Haryana State Pollution Control Board',  url: 'https://hspcb.org.in/' },
  { code: 'RJSPCB', name: 'Rajasthan State Pollution Control Board', url: 'https://environment.rajasthan.gov.in/' },
  { code: 'PPCB',   name: 'Punjab Pollution Control Board',         url: 'https://ppcb.punjab.gov.in/' },
  { code: 'UPPCB',  name: 'Uttar Pradesh Pollution Control Board',  url: 'https://uppcb.com/' },
];

const UNLOCK_KEY = 'sz_live_unlock';
const BOARD_CREDS_KEY = 'sz_live_board_creds';

/* ---------- Unlock session helpers ---------- */
function getUnlock() {
  try {
    const raw = sessionStorage.getItem(UNLOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(UNLOCK_KEY);
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function setUnlock(data) {
  try {
    sessionStorage.setItem(UNLOCK_KEY, JSON.stringify(data));
  } catch (e) {}
}

/* ---------- Board credentials store ---------- */
function loadAllCreds() {
  try {
    const raw = localStorage.getItem(BOARD_CREDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveAllCreds(creds) {
  try {
    localStorage.setItem(BOARD_CREDS_KEY, JSON.stringify(creds));
  } catch (e) {}
}

function emptyCreds() {
  return {
    tokenId: '',
    siteId: '',
    siteUserId: '',
    password: '',
    parameters: [],
  };
}

export default function Live() {
  const { sites } = useData();

  /* ==========================================================
     Hooks
     ========================================================== */
  const [unlocked, setUnlocked] = useState(Boolean(getUnlock()));
  const [unlockId, setUnlockId] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [pushing, setPushing] = useState(false);

  const [query, setQuery] = useState('');

  const [successModal, setSuccessModal] = useState(null);
  const [failModal, setFailModal] = useState(null);

  const [allCreds, setAllCreds] = useState(loadAllCreds());
  const [draft, setDraft] = useState(emptyCreds());

  /* Load saved creds when site + board change */
  useEffect(
    function () {
      if (!selectedSite || !selectedBoard) {
        setDraft(emptyCreds());
        return;
      }
      const key = selectedSite.id + '|' + selectedBoard.code;
      const saved = allCreds[key] || emptyCreds();
      const params =
        saved.parameters && saved.parameters.length
          ? saved.parameters
          : selectedSite.params.map(function (p) {
              return p.key;
            });
      setDraft(Object.assign({}, emptyCreds(), saved, { parameters: params }));
    },
    [selectedSite, selectedBoard, allCreds]
  );

  const filteredSites = useMemo(
    function () {
      if (!query.trim()) return sites;
      const q = query.toLowerCase();
      return sites.filter(function (s) {
        return (
          s.name.toLowerCase().indexOf(q) !== -1 ||
          s.id.toLowerCase().indexOf(q) !== -1 ||
          (s.sector || '').toLowerCase().indexOf(q) !== -1
        );
      });
    },
    [sites, query]
  );

  /* ==========================================================
     Handlers
     ========================================================== */
  const tryUnlock = async function () {
    setUnlockErr('');
    if (!unlockId || !unlockPass) {
      setUnlockErr('Enter both ID and password.');
      return;
    }
    setUnlocking(true);
    try {
      const result = await api.liveUnlock(unlockId, unlockPass);
      setUnlock({ token: result.token, expiresAt: Date.now() + 3600000 });
      setUnlocked(true);
      toast.success('Live push unlocked.');
    } catch (e) {
      /* Dev fallback — used while backend endpoint is being built */
      if (unlockId === 'SZ_Chandan' && unlockPass === 'SZ_2026_ECO#') {
        setUnlock({ token: 'dev-token', expiresAt: Date.now() + 3600000 });
        setUnlocked(true);
        toast.success('Live push unlocked (dev mode).');
      } else {
        setUnlockErr(e.message || 'Invalid credentials.');
      }
    } finally {
      setUnlocking(false);
    }
  };

  const persistCreds = function () {
    if (!selectedSite || !selectedBoard) return;
    const key = selectedSite.id + '|' + selectedBoard.code;
    const next = Object.assign({}, allCreds);
    next[key] = Object.assign({}, draft);
    setAllCreds(next);
    saveAllCreds(next);
    toast.success('Credentials saved for ' + selectedBoard.code);
  };

  const toggleParam = function (key) {
    setDraft(function (d) {
      const has = d.parameters.indexOf(key) !== -1;
      return Object.assign({}, d, {
        parameters: has
          ? d.parameters.filter(function (k) {
              return k !== key;
            })
          : d.parameters.concat([key]),
      });
    });
  };

  const doPush = async function () {
    if (!selectedSite || !selectedBoard) return;

    if (!draft.tokenId.trim()) {
      toast.error('Enter the Token ID for ' + selectedBoard.code);
      return;
    }
    if (!draft.siteId.trim()) {
      toast.error('Enter the Site ID for ' + selectedBoard.code);
      return;
    }
    if (!draft.siteUserId.trim()) {
      toast.error('Enter the Site User ID');
      return;
    }
    if (!draft.password) {
      toast.error('Enter the password');
      return;
    }
    if (!draft.parameters.length) {
      toast.error('Select at least one parameter');
      return;
    }

    setPushing(true);
    try {
      const result = await api.livePush({
        siteId: selectedSite.id,
        board: selectedBoard.code,
        boardSiteId: draft.siteId,
        tokenId: draft.tokenId,
        siteUserId: draft.siteUserId,
        password: draft.password,
        parameters: draft.parameters,
        token: getUnlock() ? getUnlock().token : null,
      });

      if (result && result.ok) {
        toast.success('Data successfully sent to ' + selectedBoard.code);
        setSuccessModal({
          site: selectedSite,
          board: selectedBoard,
          draft: draft,
          result: result,
        });
      } else {
        toast.error('Data not pushed ahead');
        setFailModal({
          site: selectedSite,
          board: selectedBoard,
          error: (result && result.error) || 'Push refused',
        });
      }
    } catch (e) {
      const isDev = getUnlock() && getUnlock().token === 'dev-token';
      if (isDev) {
        await new Promise(function (r) {
          setTimeout(r, 900);
        });
        if (selectedBoard.code === 'UPPCB') {
          setFailModal({
            site: selectedSite,
            board: selectedBoard,
            error: 'Endpoint returned 503 (dev-mode simulation)',
          });
        } else {
          setSuccessModal({
            site: selectedSite,
            board: selectedBoard,
            draft: draft,
            result: {
              ok: true,
              pushedAt: Date.now(),
              params: draft.parameters.length,
            },
          });
        }
      } else {
        toast.error('Push failed: ' + (e.message || 'unknown error'));
        setFailModal({
          site: selectedSite,
          board: selectedBoard,
          error: e.message,
        });
      }
    } finally {
      setPushing(false);
    }
  };

  const openSite = function (site) {
    setSelectedSite(site);
    setSelectedBoard(null);
  };

  const closeSite = function () {
    setSelectedSite(null);
    setSelectedBoard(null);
    setDraft(emptyCreds());
  };

  const lock = function () {
    sessionStorage.removeItem(UNLOCK_KEY);
    setUnlocked(false);
    toast.success('Locked.');
  };

  /* ==========================================================
     RENDER 1 — Unlock gate
     ========================================================== */
  if (!unlocked) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">Live Push</div>
            <div className="page-sub">
              <span>Push OCEMS data to your state board portal</span>
            </div>
          </div>
        </div>

        <Panel title="Authorisation required" hint="Enter your Live credentials">
          <div style={{ maxWidth: 400 }}>
            <div className="fg" style={{ marginBottom: 14 }}>
              <label>
                Live ID <span className="req">*</span>
              </label>
              <input
                value={unlockId}
                onChange={function (e) {
                  setUnlockId(e.target.value);
                }}
                placeholder="e.g. live"
                autoFocus
                onKeyDown={function (e) {
                  if (e.key === 'Enter') tryUnlock();
                }}
              />
            </div>

            <div className="fg" style={{ marginBottom: 14 }}>
              <label>
                Live Password <span className="req">*</span>
              </label>
              <input
                type="password"
                value={unlockPass}
                onChange={function (e) {
                  setUnlockPass(e.target.value);
                }}
                placeholder="password"
                onKeyDown={function (e) {
                  if (e.key === 'Enter') tryUnlock();
                }}
              />
            </div>

            <div
              style={{
                color: 'var(--st-red)',
                fontSize: 12,
                minHeight: 16,
                marginBottom: 8,
              }}
            >
              {unlockErr}
            </div>

            <button
              className="btn btn-primary btn-block"
              onClick={tryUnlock}
              disabled={unlocking}
            >
              {unlocking ? 'Unlocking...' : 'Unlock Live push'}
            </button>
          </div>
        </Panel>
      </>
    );
  }

  /* ==========================================================
     RENDER 2 — Site detail view
     ========================================================== */
  if (selectedSite) {
    const savedKey = selectedBoard
      ? selectedSite.id + '|' + selectedBoard.code
      : '';
    const savedCreds = savedKey ? allCreds[savedKey] : null;
    const allParams = selectedSite.params.map(function (p) {
      return p.key;
    });
    const selectedCount = draft.parameters.length;

    return (
      <>
        <div className="back-btn" onClick={closeSite}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </div>

        {/* Site header */}
        <div className="detail-head">
          <div>
            <div className="dh-name">{selectedSite.name}</div>
            <div className="dh-meta">
              <span className="mono">{selectedSite.id}</span>
              <span> | </span>
              <span>{selectedSite.sector || '-'}</span>
              <span> | </span>
              <span>{selectedSite.loc || '-'}</span>
              <span> | </span>
              <span>{selectedSite.spcb || '-'}</span>
            </div>
          </div>
          <div
            className={'sig ' + selectedSite.signal}
            style={{ fontSize: 12, padding: '8px 14px' }}
          >
            <span className="sd"></span>
            {SIG_LABEL[selectedSite.signal]}
          </div>
        </div>

        {/* Parameter gauges — uses custom name if present */}
        <div className="gauge-row">
          {selectedSite.params.map(function (p, idx) {
            const def = PARAMS[p.key] || {};
            const col = HEX[p.signal];
            const display = p.name || p.key;
            const limitVal = p.limit || def.limit || 0;
            return (
              <div
                className="gauge"
                key={p.pid || (p.key + '-' + idx)}
              >
                <div className="gp" title={p.key}>
                  {display}
                </div>
                <div className="gv">
                  {p.value}
                  <span className="gu">{p.unit || def.unit || ''}</span>
                </div>
                <div className="glim">
                  Limit &le; {limitVal} {p.unit || def.unit || ''}
                </div>
                <div className="gbar">
                  <i
                    style={{
                      width:
                        Math.min(
                          100,
                          (p.value / (limitVal * 1.6 || 100)) * 100
                        ) + '%',
                      background: col,
                    }}
                  ></i>
                </div>
              </div>
            );
          })}
        </div>

        {/* Board selector */}
        <Panel
          title="Select State Board"
          hint="Choose where to push this site's data"
        >
          <div className="fg">
            <select
              value={selectedBoard ? selectedBoard.code : ''}
              onChange={function (e) {
                const b = BOARDS.find(function (x) {
                  return x.code === e.target.value;
                });
                setSelectedBoard(b || null);
              }}
            >
              <option value="">- Choose a board -</option>
              {BOARDS.map(function (b) {
                return (
                  <option key={b.code} value={b.code}>
                    {b.code} - {b.name}
                  </option>
                );
              })}
            </select>
          </div>
        </Panel>

        {selectedBoard ? (
          <>
            {/* ---- Credentials panel ---- */}
            <Panel
              title={selectedBoard.code + ' Credentials'}
              hint="Manually enter the IDs and password issued by the board"
              right={
                <button
                  className="btn btn-primary btn-sm"
                  onClick={persistCreds}
                >
                  Save credentials
                </button>
              }
            >
              <div className="form-grid">
                <div className="fg">
                  <label>
                    Token ID <span className="req">*</span>
                  </label>
                  <input
                    value={draft.tokenId}
                    onChange={function (e) {
                      setDraft(
                        Object.assign({}, draft, { tokenId: e.target.value })
                      );
                    }}
                    placeholder={
                      'API key or bearer token issued by ' + selectedBoard.code
                    }
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="fg">
                  <label>
                    {selectedBoard.code} Site ID <span className="req">*</span>
                  </label>
                  <input
                    value={draft.siteId}
                    onChange={function (e) {
                      setDraft(
                        Object.assign({}, draft, { siteId: e.target.value })
                      );
                    }}
                    placeholder={
                      'Site ID as registered on ' + selectedBoard.code
                    }
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="fg">
                  <label>
                    Site User ID <span className="req">*</span>
                  </label>
                  <input
                    value={draft.siteUserId}
                    onChange={function (e) {
                      setDraft(
                        Object.assign({}, draft, {
                          siteUserId: e.target.value,
                        })
                      );
                    }}
                    placeholder="Username provided by the board"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="fg">
                  <label>
                    Password <span className="req">*</span>
                  </label>
                  <input
                    type="password"
                    value={draft.password}
                    onChange={function (e) {
                      setDraft(
                        Object.assign({}, draft, {
                          password: e.target.value,
                        })
                      );
                    }}
                    placeholder="Password provided by the board"
                  />
                </div>

                <div className="fg" style={{ gridColumn: '1 / -1' }}>
                  <label>
                    Local Portal Site ID{' '}
                    <span style={{ color: 'var(--mute)', fontWeight: 400 }}>
                      (auto - Saaphzone internal)
                    </span>
                  </label>
                  <input
                    value={selectedSite.id}
                    disabled
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <div className="hint">
                    Sent as <code style={{ fontSize: 11 }}>localSiteId</code>{' '}
                    in the payload so the board can cross-reference.
                  </div>
                </div>

                <div className="fg" style={{ gridColumn: '1 / -1' }}>
                  <label>
                    Parameters to push <span className="req">*</span>{' '}
                    <span
                      style={{ color: 'var(--mute)', fontWeight: 400 }}
                    >
                      ({selectedCount} of {allParams.length} selected)
                    </span>
                  </label>
                  <div className="checkgrid" style={{ marginTop: 6 }}>
                    {allParams.map(function (k) {
                      const on = draft.parameters.indexOf(k) !== -1;
                      return (
                        <label
                          key={k}
                          className={'chk ' + (on ? 'on' : '')}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={function () {
                              toggleParam(k);
                            }}
                          />
                          <span>{k}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={function () {
                        setDraft(
                          Object.assign({}, draft, {
                            parameters: allParams.slice(),
                          })
                        );
                      }}
                    >
                      Select all
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={function () {
                        setDraft(
                          Object.assign({}, draft, { parameters: [] })
                        );
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              </div>

              {savedCreds ? (
                <div
                  style={{
                    marginTop: 16,
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--ink-3)',
                  }}
                >
                  Saved credentials exist for this site on{' '}
                  {selectedBoard.code}
                  {savedCreds.siteId
                    ? ' (Site ID: ' + savedCreds.siteId + ')'
                    : ''}
                </div>
              ) : null}
            </Panel>

            {/* ---- Push panel ---- */}
            <Panel
              title={'Push to ' + selectedBoard.code}
              hint={selectedBoard.name}
              right={
                <button
                  className="btn btn-primary"
                  onClick={doPush}
                  disabled={pushing}
                >
                  {pushing ? 'Pushing...' : 'Hit'}
                </button>
              }
            >
              <div className="form-grid">
                <div className="fg">
                  <label>Official portal</label>
                  <a
                    href={selectedBoard.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--primary)',
                      textDecoration: 'underline',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                    }}
                  >
                    {selectedBoard.url}
                  </a>
                </div>

                <div className="fg">
                  <label>Parameters ready</label>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                    }}
                  >
                    {draft.parameters.join(', ') || '-'}
                  </span>
                </div>

                <div className="fg">
                  <label>Ready to push?</label>
                  <div style={{ fontSize: 13 }}>
                    {draft.tokenId &&
                    draft.siteId &&
                    draft.siteUserId &&
                    draft.password &&
                    draft.parameters.length ? (
                      <span
                        style={{
                          color: 'var(--st-green)',
                          fontWeight: 600,
                        }}
                      >
                        Ready - {draft.parameters.length} parameter(s)
                      </span>
                    ) : (
                      <span
                        style={{
                          color: 'var(--st-orange)',
                          fontWeight: 600,
                        }}
                      >
                        Complete all fields to enable push
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          </>
        ) : null}

        {/* ---- Success modal ---- */}
        {successModal ? (
          <Modal
            open={true}
            title="Data successfully sent"
            onClose={function () {
              setSuccessModal(null);
            }}
            width={480}
            footer={
              <button
                className="btn btn-primary"
                onClick={function () {
                  setSuccessModal(null);
                }}
              >
                Done
              </button>
            }
          >
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: 'var(--st-green)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 30,
                  marginBottom: 12,
                }}
              >
                OK
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                Data pushed to {successModal.board.code}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-3)',
                  marginTop: 6,
                }}
              >
                <b>{successModal.site.name}</b> ({successModal.site.id})
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-3)',
                  marginTop: 4,
                }}
              >
                {successModal.board.code} Site ID:{' '}
                <b>{successModal.draft.siteId}</b>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-4)',
                  marginTop: 12,
                }}
              >
                {successModal.result && successModal.result.params
                  ? successModal.result.params
                  : 0}{' '}
                parameter(s) sent at{' '}
                {new Date(
                  (successModal.result && successModal.result.pushedAt) ||
                    Date.now()
                ).toLocaleString('en-IN')}
              </div>
            </div>
          </Modal>
        ) : null}

        {/* ---- Failure modal ---- */}
        {failModal ? (
          <Modal
            open={true}
            title="Data not pushed ahead"
            onClose={function () {
              setFailModal(null);
            }}
            width={460}
            footer={
              <button
                className="btn btn-danger"
                onClick={function () {
                  setFailModal(null);
                }}
              >
                Close
              </button>
            }
          >
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: 'var(--st-red)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 30,
                  marginBottom: 12,
                }}
              >
                X
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                Push failed for {failModal.board.code}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-3)',
                  marginTop: 6,
                }}
              >
                <b>{failModal.site.name}</b> ({failModal.site.id})
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--st-red)',
                  marginTop: 12,
                }}
              >
                {failModal.error || 'Endpoint refused the request'}
              </div>
            </div>
          </Modal>
        ) : null}
      </>
    );
  }

  /* ==========================================================
     RENDER 3 — Site grid view
     ========================================================== */
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Live Push</div>
          <div className="page-sub">
            <span className="live-dot"></span>
            <span>Push OCEMS data to state board portals</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={lock}>
          Lock
        </button>
      </div>

      <Panel
        title="Select a site"
        hint="Click any site to configure the push"
        right={
          <input
            className="search"
            placeholder="Search sites"
            value={query}
            onChange={function (e) {
              setQuery(e.target.value);
            }}
          />
        }
      >
        {filteredSites.length === 0 ? (
          <div className="empty">No sites match your search.</div>
        ) : (
          <div className="grid">
            {filteredSites.map(function (s) {
              return (
                <div
                  key={s.id}
                  className={'icard ' + s.signal}
                  onClick={function () {
                    openSite(s);
                  }}
                >
                  <div className="icard-rail"></div>
                  <div className="icard-head">
                    <div className="icard-title">
                      <div>
                        <div className="icard-name">{s.name}</div>
                        <div className="icard-meta">
                          <span className="mono">{s.id}</span>
                          <span className="sep"> | </span>
                          <span>{s.sector || '-'}</span>
                        </div>
                      </div>
                      <span className="status-pill">
                        <span className={'status-dot ' + s.signal}></span>
                        {SIG_LABEL[s.signal]}
                      </span>
                    </div>
                  </div>
                  <div className="icard-body">
                    {s.params.slice(0, 3).map(function (p, i) {
                      return (
                        <div
                          className="param-row"
                          key={p.pid || (p.key + '-' + i)}
                        >
                          <span className="pname">
                            {p.name || p.key}
                          </span>
                          <span className="pval">{p.value}</span>
                          <span className="plimit">
                            {'<='}
                            {(PARAMS[p.key] && PARAMS[p.key].limit) ||
                              p.limit}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="icard-foot">
                    <span>{s.loc || '-'}</span>
                    <span
                      className="mono"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      {s.spcb || '-'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}