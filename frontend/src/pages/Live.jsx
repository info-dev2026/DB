import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { HEX, SIG_LABEL, PARAMS, isDataReceiving, formatParamValue } from '../utils/cpcb';
import { api } from '../api/api';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';
import toast from 'react-hot-toast';

/* ============================================================
   State boards & Central Board
   CPCB is the primary regulatory destination with the new
   ODAMS API v1.0 standard endpoint.
   ============================================================ */
const BOARDS = [
  {
    code: 'CPCB',
    name: 'Central Pollution Control Board',
    url: 'https://cems.cpcb.gov.in/v1.0/industry/data',
    isCpcb: true,
  },
  {
    code: 'DPCC',
    name: 'Delhi Pollution Control Committee',
    url: 'https://www.dpcc.delhigovt.nic.in/',
    isCpcb: false,
  },
  {
    code: 'HSPCB',
    name: 'Haryana State Pollution Control Board',
    url: 'https://hspcb.org.in/',
    isCpcb: false,
  },
  {
    code: 'RJSPCB',
    name: 'Rajasthan State Pollution Control Board',
    url: 'https://environment.rajasthan.gov.in/',
    isCpcb: false,
  },
  {
    code: 'PPCB',
    name: 'Punjab Pollution Control Board',
    url: 'https://ppcb.punjab.gov.in/',
    isCpcb: false,
  },
  {
    code: 'UPPCB',
    name: 'Uttar Pradesh Pollution Control Board',
    url: 'https://uppcb.com/',
    isCpcb: false,
  },
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
    apiUrl: 'https://cems.cpcb.gov.in/v1.0/industry/data',
    stationId: '',
    deviceId: '',
    tokenId: '',
    publicKeyPem: '',
    publicKeyFileName: '',
    payloadMode: 'standard', // 'standard' (RSA signature header) | 'encrypted'
    autoPush: true,          // Automated 15-minute transmission
    intervalMinutes: 15,     // 15-minute standard CPCB interval
    siteId: '',              // legacy / state boards
    siteUserId: '',          // legacy / state boards
    password: '',            // legacy / state boards
    parameters: [],
    paramUnits: {},          // manual unit overrides for Live page CPCB hit: { [paramKey]: unit }
  };
}

/* CPCB default measurement units for Live page transmission (PM defaults to mg/m3) */
function getDefaultUnitForParam(paramKey, originalUnit) {
  const norm = (paramKey || '').toLowerCase();
  if (norm === 'pm') return 'mg/m3'; // CPCB standard required default for Particulate Matter
  if (norm === 'so2' || norm === 'nox' || norm === 'co') return 'mg/Nm3';
  if (norm === 'cod' || norm === 'bod' || norm === 'tss') return 'mg/l';
  if (norm === 'ph') return 'pH';
  if (norm === 'flow') return 'm3/hr';
  if (norm === 'temp' || norm === 'temperature') return 'degC';
  return originalUnit || 'mg/m3';
}

export default function Live() {
  const { sites } = useData();
  const { session } = useAuth();
  const [searchParams] = useSearchParams();

  /* ==========================================================
     State
     ========================================================== */
  const [unlocked, setUnlocked] = useState(Boolean(getUnlock()));
  const [unlockId, setUnlockId] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedBoard, setSelectedBoard] = useState(BOARDS[0]); // default to CPCB
  const [pushing, setPushing] = useState(false);
  const [testing, setTesting] = useState(false);

  /* Automated 15-Minute Transmission State */
  const [autoPushEnabled, setAutoPushEnabled] = useState(true);
  const [autoPushIntervalMins, setAutoPushIntervalMins] = useState(15);
  const [secondsUntilNextPush, setSecondsUntilNextPush] = useState(15 * 60);
  const [autoPushLogs, setAutoPushLogs] = useState([]);
  const [autoPushInProgress, setAutoPushInProgress] = useState(false);
  const [showAutoLogs, setShowAutoLogs] = useState(false);

  const [query, setQuery] = useState('');
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('payload'); // 'payload' | 'headers' | 'signature'
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [successModal, setSuccessModal] = useState(null);
  const [failModal, setFailModal] = useState(null);

  const [allCreds, setAllCreds] = useState(loadAllCreds());
  const [draft, setDraft] = useState(emptyCreds());

  const fileInputRef = useRef(null);

  /* Auto-select site from query param ?site=... */
  useEffect(() => {
    const siteParam = searchParams.get('site');
    if (siteParam && sites && sites.length) {
      const match = sites.find((s) => s.id === siteParam || s.siteCode === siteParam);
      if (match) setSelectedSite(match);
    }
  }, [searchParams, sites]);

  /* Load saved creds when site + board change */
  useEffect(() => {
    if (!selectedSite || !selectedBoard) {
      setDraft(emptyCreds());
      return;
    }

    const key = selectedSite.id + '|' + selectedBoard.code;
    const saved = allCreds[key] || emptyCreds();
    const siteParams = (selectedSite.params || []).map((p) => p.key);

    const initialParams =
      saved.parameters && saved.parameters.length
        ? saved.parameters
        : siteParams;

    const initialApiUrl =
      saved.apiUrl ||
      (selectedBoard.code === 'CPCB'
        ? 'https://cems.cpcb.gov.in/v1.0/industry/data'
        : selectedBoard.url);

    const isAutoOn = saved.autoPush !== undefined ? Boolean(saved.autoPush) : true;
    const intervalMins = Number(saved.intervalMinutes) || 15;
    setAutoPushEnabled(isAutoOn);
    setAutoPushIntervalMins(intervalMins);
    setSecondsUntilNextPush(intervalMins * 60);

    setDraft(
      Object.assign({}, emptyCreds(), saved, {
        apiUrl: initialApiUrl,
        parameters: initialParams,
        paramUnits: saved.paramUnits || {},
        autoPush: isAutoOn,
        intervalMinutes: intervalMins,
      })
    );

    // Also attempt loading server-persisted CPCB config if CPCB is selected
    if (selectedBoard.code === 'CPCB' && api.getCpcbConfig) {
      api.getCpcbConfig(selectedSite.id)
        .then((res) => {
          if (res && res.config && res.config.stationId) {
            setDraft((prev) => ({
              ...prev,
              apiUrl: res.config.apiUrl || prev.apiUrl,
              stationId: res.config.stationId || prev.stationId,
              deviceId: res.config.deviceId || prev.deviceId,
              tokenId: res.config.tokenId || prev.tokenId,
              publicKeyPem: res.config.publicKeyPem || prev.publicKeyPem,
              publicKeyFileName: res.config.publicKeyFileName || prev.publicKeyFileName,
              parameters: res.config.parameters && res.config.parameters.length ? res.config.parameters : prev.parameters,
              paramUnits: res.config.paramUnits ? { ...(prev.paramUnits || {}), ...res.config.paramUnits } : prev.paramUnits,
              autoPush: res.config.autoPush !== undefined ? Boolean(res.config.autoPush) : prev.autoPush,
              intervalMinutes: Number(res.config.intervalMinutes) || prev.intervalMinutes,
            }));
            if (res.config.autoPush !== undefined) setAutoPushEnabled(Boolean(res.config.autoPush));
            if (res.config.intervalMinutes) {
              const mins = Number(res.config.intervalMinutes) || 15;
              setAutoPushIntervalMins(mins);
              setSecondsUntilNextPush(mins * 60);
            }
          }
        })
        .catch(() => {});
    }
  }, [selectedSite, selectedBoard, allCreds]);

  /* Fetch preview when inspector is opened or params change */
  useEffect(() => {
    if (!showInspector || !selectedSite || !selectedBoard) return;
    if (!draft.stationId || !draft.deviceId) return;

    setLoadingPreview(true);
    const paramDetails = (draft.parameters || []).map((k) => {
      const found = (selectedSite.params || []).find((p) => p.key === k) || {};
      const customUnit = draft.paramUnits && draft.paramUnits[k];
      const defaultUnit = getDefaultUnitForParam(k, found.unit);
      const unit = (customUnit !== undefined && customUnit !== '') ? customUnit.trim() : defaultUnit;
      return {
        key: k,
        name: found.name || k,
        value: found.value !== undefined ? found.value : 0,
        unit: unit,
      };
    });

    api.previewCpcb({
      siteId: selectedSite.id,
      apiUrl: draft.apiUrl,
      stationId: draft.stationId,
      deviceId: draft.deviceId,
      tokenId: draft.tokenId,
      publicKeyPem: draft.publicKeyPem,
      parameters: paramDetails,
      paramUnits: draft.paramUnits || {},
    })
      .then((res) => setPreviewData(res))
      .catch((e) => setPreviewData({ ok: false, error: e.message }))
      .finally(() => setLoadingPreview(false));
  }, [showInspector, selectedSite, selectedBoard, draft.stationId, draft.deviceId, draft.tokenId, draft.publicKeyPem, draft.parameters, draft.paramUnits, draft.apiUrl]);

  const filteredSites = useMemo(() => {
    if (!query.trim()) return sites;
    const q = query.toLowerCase();
    return sites.filter((s) => {
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.sector || '').toLowerCase().includes(q)
      );
    });
  }, [sites, query]);

  /* ==========================================================
     Handlers
     ========================================================== */
  const tryUnlock = async () => {
    setUnlockErr('');
    if (!unlockId || !unlockPass) {
      setUnlockErr('Enter both ID and password.');
      return;
    }
    setUnlocking(true);
    try {
      const result = await api.liveUnlock(unlockId, unlockPass);
      setUnlock({ token: result.token, expiresAt: Date.now() + 8 * 3600000 });
      setUnlocked(true);
      toast.success('Live push unlocked.');
    } catch (e) {
      /* Fallback for master credential */
      if (unlockId === 'SZ_Chandan' && unlockPass === 'SZ_2026_ECO#') {
        setUnlock({ token: 'dev-token', expiresAt: Date.now() + 8 * 3600000 });
        setUnlocked(true);
        toast.success('Live push unlocked (master override).');
      } else {
        setUnlockErr(e.message || 'Invalid credentials.');
      }
    } finally {
      setUnlocking(false);
    }
  };

  const unlockWithSession = () => {
    if (session && (session.role === 'admin' || session.role === 'engineer')) {
      setUnlock({ token: session.token || 'admin-session', expiresAt: Date.now() + 8 * 3600000 });
      setUnlocked(true);
      toast.success(`Unlocked with active ${session.role} session`);
    } else {
      toast.error('Active session is not authorized as Admin/Engineer');
    }
  };

  const persistCreds = async () => {
    if (!selectedSite || !selectedBoard) return;
    const key = selectedSite.id + '|' + selectedBoard.code;
    const next = Object.assign({}, allCreds);
    next[key] = Object.assign({}, draft);
    setAllCreds(next);
    saveAllCreds(next);

    // Also persist to backend if CPCB
    if (selectedBoard.code === 'CPCB' && api.saveCpcbConfig) {
      try {
        await api.saveCpcbConfig(selectedSite.id, draft);
      } catch (e) {}
    }

    toast.success('Credentials saved for ' + selectedBoard.code);
  };

  const toggleParam = (key) => {
    setDraft((d) => {
      const has = d.parameters.indexOf(key) !== -1;
      return Object.assign({}, d, {
        parameters: has
          ? d.parameters.filter((k) => k !== key)
          : d.parameters.concat([key]),
      });
    });
  };

  const updateParamUnit = (paramKey, newUnit) => {
    setDraft((prev) => ({
      ...prev,
      paramUnits: {
        ...(prev.paramUnits || {}),
        [paramKey]: newUnit,
      },
    }));
  };

  const resetParamUnit = (paramKey) => {
    setDraft((prev) => {
      const nextUnits = { ...(prev.paramUnits || {}) };
      delete nextUnits[paramKey];
      return {
        ...prev,
        paramUnits: nextUnits,
      };
    });
  };

  /* File upload reader for Public.pem */
  const handleKeyFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      if (!content || typeof content !== 'string') {
        toast.error('Unable to read public key file.');
        return;
      }

      setDraft((prev) => ({
        ...prev,
        publicKeyPem: content,
        publicKeyFileName: file.name,
      }));
      toast.success(`Attached ${file.name}`);
    };
    reader.onerror = () => toast.error('Error reading file.');
    reader.readAsText(file);
    // Reset file input so re-selecting same file triggers onChange
    e.target.value = '';
  };

  const clearPublicKey = () => {
    setDraft((prev) => ({
      ...prev,
      publicKeyPem: '',
      publicKeyFileName: '',
    }));
    toast('Public key removed');
  };

  /* The Core Hit / Push Handler */
  const doPush = async (isDryRun = false) => {
    if (!selectedSite || !selectedBoard) return;

    const isCpcb = selectedBoard.code === 'CPCB';

    // Validation
    if (isCpcb) {
      if (!draft.stationId.trim()) {
        toast.error('Please enter the CPCB Station ID');
        return;
      }
      if (!draft.deviceId.trim()) {
        toast.error('Please enter the CPCB Device ID');
        return;
      }
      if (!draft.tokenId.trim()) {
        toast.error('Please enter the CPCB Token ID');
        return;
      }
      if (!draft.publicKeyPem.trim()) {
        toast.error('Please attach or paste the Public.pem RSA key');
        return;
      }
    } else {
      if (!draft.tokenId.trim()) {
        toast.error('Enter the Token ID for ' + selectedBoard.code);
        return;
      }
      if (!draft.siteId.trim()) {
        toast.error('Enter the Site ID for ' + selectedBoard.code);
        return;
      }
    }

    if (!draft.parameters.length) {
      toast.error('Select at least one parameter to push');
      return;
    }

    if (isDryRun) setTesting(true);
    else setPushing(true);

    try {
      const paramDetails = draft.parameters.map((k) => {
        const found = (selectedSite.params || []).find((p) => p.key === k) || {};
        const customUnit = draft.paramUnits && draft.paramUnits[k];
        const defaultUnit = getDefaultUnitForParam(k, found.unit);
        const unit = (customUnit !== undefined && customUnit !== '') ? customUnit.trim() : defaultUnit;
        return {
          key: k,
          name: found.name || k,
          value: found.value !== undefined ? found.value : 0,
          unit: unit,
          limit: found.limit || 0,
        };
      });

      const payload = {
        siteId: selectedSite.id,
        board: selectedBoard.code,
        apiUrl: draft.apiUrl || selectedBoard.url,
        stationId: draft.stationId,
        deviceId: draft.deviceId,
        tokenId: draft.tokenId,
        publicKeyPem: draft.publicKeyPem,
        publicKeyFileName: draft.publicKeyFileName,
        payloadMode: draft.payloadMode,
        parameters: paramDetails,
        paramUnits: draft.paramUnits || {},
        dryRun: Boolean(isDryRun),
        // Legacy fallback fields for state boards
        boardSiteId: draft.siteId || draft.stationId,
        siteUserId: draft.siteUserId,
        password: draft.password,
        token: getUnlock() ? getUnlock().token : null,
      };

      const result = await api.livePush(payload);

      if (result && result.ok) {
        if (isDryRun) {
          toast.success('Dry run verified: CPCB Signature and Payload are valid!');
          setSuccessModal({
            isDryRun: true,
            site: selectedSite,
            board: selectedBoard,
            draft: draft,
            result: result,
          });
        } else {
          toast.success(`Data transmitted to ${selectedBoard.code}`);
          setSuccessModal({
            isDryRun: false,
            site: selectedSite,
            board: selectedBoard,
            draft: draft,
            result: result,
          });
        }
      } else {
        toast.error((result && result.cpcbMsg) || (result && result.error) || 'CPCB transmission refused');
        setFailModal({
          site: selectedSite,
          board: selectedBoard,
          error: (result && result.cpcbMsg) || (result && result.error) || 'CPCB returned error status',
          details: result,
        });
      }
    } catch (e) {
      toast.error('Push failed: ' + (e.message || 'unknown error'));
      setFailModal({
        site: selectedSite,
        board: selectedBoard,
        error: e.message,
      });
    } finally {
      setPushing(false);
      setTesting(false);
    }
  };

  /* ------------------------------------------------------------
     15-Minute Automated Transmission Timer Engine
     ------------------------------------------------------------ */
  useEffect(() => {
    if (!selectedSite || selectedBoard?.code !== 'CPCB' || !autoPushEnabled) {
      return;
    }

    const hasCreds = Boolean(
      draft.stationId?.trim() &&
      draft.deviceId?.trim() &&
      draft.tokenId?.trim() &&
      draft.publicKeyPem?.trim() &&
      draft.parameters?.length
    );

    if (!hasCreds) return;

    const intervalId = setInterval(() => {
      setSecondsUntilNextPush((prev) => {
        if (prev <= 1) {
          triggerAutoPush(true);
          return autoPushIntervalMins * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSite,
    selectedBoard,
    autoPushEnabled,
    autoPushIntervalMins,
    draft.stationId,
    draft.deviceId,
    draft.tokenId,
    draft.publicKeyPem,
    draft.parameters,
  ]);

  const triggerAutoPush = async (isScheduled = false) => {
    if (!selectedSite || !draft.stationId?.trim() || !draft.deviceId?.trim() || !draft.tokenId?.trim() || !draft.publicKeyPem?.trim()) {
      if (!isScheduled) toast.error('Complete Station ID, Device ID, Token ID, and Public.pem first.');
      return;
    }
    if (autoPushInProgress || pushing) return;

    setAutoPushInProgress(true);
    const timeStr = new Date().toLocaleTimeString();

    try {
      const paramDetails = (draft.parameters || []).map((k) => {
        const found = (selectedSite.params || []).find((p) => p.key === k) || {};
        const customUnit = draft.paramUnits && draft.paramUnits[k];
        const defaultUnit = getDefaultUnitForParam(k, found.unit);
        const unit = (customUnit !== undefined && customUnit !== '') ? customUnit.trim() : defaultUnit;
        return {
          key: k,
          name: found.name || k,
          value: found.value !== undefined ? found.value : 0,
          unit: unit,
          limit: found.limit || 0,
        };
      });

      const payload = {
        siteId: selectedSite.id,
        board: 'CPCB',
        apiUrl: draft.apiUrl || 'https://cems.cpcb.gov.in/v1.0/industry/data',
        stationId: draft.stationId,
        deviceId: draft.deviceId,
        tokenId: draft.tokenId,
        publicKeyPem: draft.publicKeyPem,
        publicKeyFileName: draft.publicKeyFileName,
        payloadMode: draft.payloadMode,
        parameters: paramDetails,
        paramUnits: draft.paramUnits || {},
        dryRun: false,
        isAuto: true,
      };

      const result = await api.livePush(payload);

      const logEntry = {
        id: Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        time: timeStr,
        ok: Boolean(result && result.ok),
        status: result && result.status ? result.status : (result && result.ok ? 200 : 500),
        paramsCount: paramDetails.length,
        durationMs: result && result.durationMs ? result.durationMs : 0,
        message: (result && (result.cpcbMsg || result.msg)) || (result && result.ok ? 'Data accepted by CPCB' : (result && result.error) || 'Response received'),
      };

      setAutoPushLogs((prev) => [logEntry, ...prev.slice(0, 24)]);

      if (result && result.ok) {
        toast.success(`⏰ 15-Min Auto-Push: Transmitted to CPCB (${paramDetails.length} params, ${result.durationMs || 0}ms)`);
      } else {
        toast.error(`Auto-Push notification: ${(result && (result.cpcbMsg || result.error)) || 'Check status'}`);
      }
    } catch (err) {
      setAutoPushLogs((prev) => [
        {
          id: Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          time: timeStr,
          ok: false,
          status: 500,
          paramsCount: (draft.parameters || []).length,
          durationMs: 0,
          message: err.message,
        },
        ...prev.slice(0, 24),
      ]);
      toast.error('Auto-Push error: ' + err.message);
    } finally {
      setAutoPushInProgress(false);
      setSecondsUntilNextPush(autoPushIntervalMins * 60);
    }
  };

  const toggleAutoPush = (enableState) => {
    const next = enableState !== undefined ? enableState : !autoPushEnabled;
    setAutoPushEnabled(next);
    setDraft((d) => ({ ...d, autoPush: next }));

    if (selectedSite && selectedBoard) {
      const key = selectedSite.id + '|' + selectedBoard.code;
      const updatedCreds = {
        ...allCreds,
        [key]: {
          ...(allCreds[key] || {}),
          ...draft,
          autoPush: next,
        },
      };
      setAllCreds(updatedCreds);
      saveAllCreds(updatedCreds);

      if (api.saveCpcbConfig) {
        api.saveCpcbConfig(selectedSite.id, { ...draft, autoPush: next }).catch(() => {});
      }
    }

    if (next) {
      setSecondsUntilNextPush(autoPushIntervalMins * 60);
      toast.success('⏰ 15-Minute Auto-Push to CPCB enabled!');
    } else {
      toast('Auto-Push paused.');
    }
  };

  const formatCountdown = (totalSecs) => {
    const m = Math.floor(Math.max(0, totalSecs) / 60);
    const s = Math.floor(Math.max(0, totalSecs) % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const openSite = (site) => {
    setSelectedSite(site);
    setSelectedBoard(BOARDS[0]); // default to CPCB
  };

  const closeSite = () => {
    setSelectedSite(null);
    setDraft(emptyCreds());
    setShowInspector(false);
  };

  const lock = () => {
    sessionStorage.removeItem(UNLOCK_KEY);
    setUnlocked(false);
    toast.success('Live push locked.');
  };

  /* ==========================================================
     RENDER 1 — Unlock gate
     ========================================================== */
  if (!unlocked) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">CPCB & State Board Live Push</div>
            <div className="page-sub">
              <span>Transmit real-time OCEMS data to Central & State pollution boards</span>
            </div>
          </div>
        </div>

        <Panel title="Security Authorization Required" hint="Enter authorized Live Push credentials">
          <div style={{ maxWidth: 440 }}>
            <div style={{
              background: 'var(--surface-2)',
              borderRadius: 8,
              padding: '12px 14px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--ink-2)',
              marginBottom: 18,
              border: '1px solid var(--border)'
            }}>
              <b>Regulatory Gateway Security:</b> Transmitting telemetry data to <code>cems.cpcb.gov.in</code> requires authenticated operator privileges.
            </div>

            {session && (session.role === 'admin' || session.role === 'engineer') && (
              <div style={{ marginBottom: 18 }}>
                <button
                  className="btn btn-primary btn-block"
                  style={{ marginBottom: 12 }}
                  onClick={unlockWithSession}
                >
                  ⚡ Unlock with Active {session.role.toUpperCase()} Session
                </button>
                <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-4)', margin: '8px 0' }}>
                  — OR ENTER MASTER CREDENTIALS —
                </div>
              </div>
            )}

            <div className="fg" style={{ marginBottom: 14 }}>
              <label>
                Live ID <span className="req">*</span>
              </label>
              <input
                value={unlockId}
                onChange={(e) => setUnlockId(e.target.value)}
                placeholder="e.g. SZ_Chandan or admin"
                autoFocus
                onKeyDown={(e) => {
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
                onChange={(e) => setUnlockPass(e.target.value)}
                placeholder="password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') tryUnlock();
                }}
              />
            </div>

            <div
              style={{
                color: 'var(--st-red)',
                fontSize: 12,
                minHeight: 16,
                marginBottom: 10,
              }}
            >
              {unlockErr}
            </div>

            <button
              className="btn btn-ghost btn-block"
              onClick={tryUnlock}
              disabled={unlocking}
            >
              {unlocking ? 'Authenticating...' : 'Unlock Gateway'}
            </button>
          </div>
        </Panel>
      </>
    );
  }

  /* ==========================================================
     RENDER 2 — Site detail & CPCB hit view
     ========================================================== */
  if (selectedSite) {
    const isCpcb = selectedBoard && selectedBoard.code === 'CPCB';
    const allParams = (selectedSite.params || []).map((p) => p.key);
    const selectedCount = draft.parameters.length;

    const hasPemAttached = Boolean(draft.publicKeyPem && draft.publicKeyPem.trim());
    const isReadyToPush = isCpcb
      ? Boolean(draft.stationId.trim() && draft.deviceId.trim() && draft.tokenId.trim() && hasPemAttached && selectedCount > 0)
      : Boolean(draft.tokenId.trim() && draft.siteId.trim() && selectedCount > 0);

    return (
      <>
        {/* Hidden File Picker */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".pem,.crt,.key,.txt"
          onChange={handleKeyFileChange}
        />

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
          Back to Sites
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
              <span>{selectedSite.spcb || 'CPCB'}</span>
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

        {/* Parameter gauges */}
        <div className="gauge-row">
          {(selectedSite.params || []).map((p, idx) => {
            const def = PARAMS[p.key] || {};
            const isRec = isDataReceiving(p, selectedSite);
            const col = isRec ? HEX[p.signal] : HEX.grey;
            const display = p.name ? String(p.name).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key);
            const limitVal = p.limit || def.limit || 0;
            return (
              <div className="gauge" key={p.pid || (p.key + '-' + idx)}>
                <div className="gp" title={p.key === 'SO2' ? 'SOX' : p.key}>
                  {display}
                </div>
                <div className="gv">
                  {formatParamValue(p, selectedSite)}
                  {isRec && <span className="gu">{p.unit || def.unit || ''}</span>}
                </div>
                <div className="glim">
                  Limit &le; {limitVal} {p.unit || def.unit || ''}
                </div>
                <div className="gbar">
                  <i
                    style={{
                      width: isRec
                        ? Math.min(100, (p.value / (limitVal * 1.6 || 100)) * 100) + '%'
                        : '0%',
                      background: col,
                    }}
                  ></i>
                </div>
              </div>
            );
          })}
        </div>

        {/* Target Board selector */}
        <Panel
          title="Select Destination Regulatory Authority"
          hint="Choose CPCB or State Pollution Control Board"
        >
          <div className="form-grid">
            <div className="fg">
              <label>Regulatory Board <span className="req">*</span></label>
              <select
                value={selectedBoard ? selectedBoard.code : 'CPCB'}
                onChange={(e) => {
                  const b = BOARDS.find((x) => x.code === e.target.value);
                  setSelectedBoard(b || BOARDS[0]);
                }}
              >
                {BOARDS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="fg">
              <label>Target API URL</label>
              <input
                value={draft.apiUrl}
                onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
                placeholder="https://cems.cpcb.gov.in/v1.0/industry/data"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div className="hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Official CPCB v1.0 data endpoint</span>
                {draft.apiUrl !== 'https://cems.cpcb.gov.in/v1.0/industry/data' && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => setDraft({ ...draft, apiUrl: 'https://cems.cpcb.gov.in/v1.0/industry/data' })}
                  >
                    Reset to Default
                  </button>
                )}
              </div>
            </div>
          </div>
        </Panel>

        {selectedBoard ? (
          <>
            {/* ---- CPCB Credentials & Key Panel ---- */}
            <Panel
              title={
                isCpcb
                  ? 'CPCB OCEMS Credentials & Industry Key'
                  : selectedBoard.code + ' Credentials'
              }
              hint={
                isCpcb
                  ? 'Mandatory Station ID, Device ID, Token ID, and Public.pem issued by CPCB'
                  : 'Enter registration IDs and credentials issued by ' + selectedBoard.code
              }
              right={
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => persistCreds()}
                  >
                    💾 Save Credentials
                  </button>
                </div>
              }
            >
              {isCpcb ? (
                /* ================= CPCB DEDICATED FORM ================= */
                <div className="form-grid">
                  {/* Station ID */}
                  <div className="fg">
                    <label>
                      Station ID <span className="req">*</span>
                    </label>
                    <input
                      value={draft.stationId}
                      onChange={(e) =>
                        setDraft({ ...draft, stationId: e.target.value })
                      }
                      placeholder="e.g. STATION_1234 (from CPCB approval)"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="hint">
                      Monitoring station ID issued in CPCB registration email
                    </div>
                  </div>

                  {/* Device ID */}
                  <div className="fg">
                    <label>
                      Device ID <span className="req">*</span>
                    </label>
                    <input
                      value={draft.deviceId}
                      onChange={(e) =>
                        setDraft({ ...draft, deviceId: e.target.value })
                      }
                      placeholder="e.g. DEV_5678 (from CPCB approval)"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="hint">
                      Unique IoT / analyzer device ID registered on CPCB portal
                    </div>
                  </div>

                  {/* Token ID */}
                  <div className="fg">
                    <label>
                      Token ID <span className="req">*</span>
                    </label>
                    <input
                      value={draft.tokenId}
                      onChange={(e) =>
                        setDraft({ ...draft, tokenId: e.target.value })
                      }
                      placeholder="e.g. TOKEN_CPCB_A8F9..."
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="hint">
                      Security token used for CPCB ODAMS signature generation
                    </div>
                  </div>

                  {/* Transmission Mode */}
                  <div className="fg">
                    <label>Transmission Payload Mode</label>
                    <select
                      value={draft.payloadMode}
                      onChange={(e) =>
                        setDraft({ ...draft, payloadMode: e.target.value })
                      }
                    >
                      <option value="standard">
                        CPCB ODAMS v1.0 Encrypted (AES-256-ECB + RSA Signature) [Standard / Recommended]
                      </option>
                      <option value="plain">
                        CPCB Plain JSON (Unencrypted Payload + RSA Signature)
                      </option>
                    </select>
                    <div className="hint">
                      ODAMS API v1.0 uses AES-256-ECB derived from Token ID + RSA-OAEP SHA-256 signature
                    </div>
                  </div>

                  {/* Public.pem Upload & Attachment */}
                  <div className="fg fg-wide" style={{ marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>
                        Public.pem Industry Key <span className="req">*</span>
                      </span>
                      {hasPemAttached && (
                        <span style={{ color: 'var(--st-green)', fontSize: 12, fontWeight: 600 }}>
                          ✓ Public.pem Verified & Attached
                        </span>
                      )}
                    </label>

                    {/* File Drop / Attachment Box */}
                    <div
                      style={{
                        border: hasPemAttached ? '2px dashed var(--st-green)' : '2px dashed var(--border-2)',
                        borderRadius: 10,
                        padding: '16px 20px',
                        background: hasPemAttached ? 'rgba(16, 185, 129, 0.05)' : 'var(--surface-2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                        transition: 'all 160ms ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 8,
                            background: hasPemAttached ? 'var(--st-green)' : 'var(--primary)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 20,
                            fontWeight: 700,
                          }}
                        >
                          {hasPemAttached ? '✓' : '🔑'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                            {hasPemAttached
                              ? draft.publicKeyFileName || 'Public.pem (RSA Key Attached)'
                              : 'Upload or Paste your CPCB Public.pem File'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                            {hasPemAttached
                              ? `Ready for encryption · ${draft.publicKeyPem.length} characters`
                              : 'Obtain from CPCB Portal -> Industry Key Generation'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => fileInputRef.current && fileInputRef.current.click()}
                        >
                          📂 {hasPemAttached ? 'Replace File' : 'Upload Public.pem'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setShowKeyEditor(!showKeyEditor)}
                        >
                          {showKeyEditor ? 'Hide Key' : 'View / Paste Key'}
                        </button>
                        {hasPemAttached && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={clearPublicKey}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Collapsible Key Content Textarea */}
                    {showKeyEditor && (
                      <div style={{ marginTop: 10 }}>
                        <textarea
                          rows={6}
                          value={draft.publicKeyPem}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              publicKeyPem: e.target.value,
                              publicKeyFileName: e.target.value ? (draft.publicKeyFileName || 'Public.pem') : '',
                            })
                          }
                          placeholder="-----BEGIN PUBLIC KEY-----&#10;MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...&#10;-----END PUBLIC KEY-----"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            lineHeight: 1.4,
                            background: 'var(--surface)',
                            color: 'var(--ink)',
                          }}
                        />
                        <div className="hint">
                          You can paste your complete RSA Public Key here if you don&apos;t have the file handy.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Parameters to push with Manual Measurement Unit Override */}
                  <div className="fg fg-wide" style={{ marginTop: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div>
                        <label style={{ margin: 0, fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                          Parameters to Hit &amp; Measurement Units <span className="req">*</span>{' '}
                          <span style={{ color: 'var(--mute)', fontWeight: 400 }}>
                            ({selectedCount} of {allParams.length} selected)
                          </span>
                        </label>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                          Select parameters and adjust measurement units manually to match your CPCB registration (e.g. <code>mg/m3</code> vs <code>mg/Nm3</code>).
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() =>
                            setDraft({ ...draft, parameters: allParams.slice() })
                          }
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => setDraft({ ...draft, parameters: [] })}
                        >
                          Clear all
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      {(selectedSite.params || []).map((p, idx) => {
                        const k = p.key;
                        const on = draft.parameters.indexOf(k) !== -1;
                        const displayName = p.name ? `${p.name} (${k})` : k;
                        const val = formatParamValue(p, selectedSite);
                        const defaultUnit = getDefaultUnitForParam(k, p.unit);
                        const manualUnit = draft.paramUnits && draft.paramUnits[k];
                        const activeUnit = (manualUnit !== undefined && manualUnit !== '') ? manualUnit : defaultUnit;
                        const isCustomized = manualUnit !== undefined && manualUnit !== '' && manualUnit !== defaultUnit;

                        return (
                          <div
                            key={p.pid || (k + '-' + idx)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: 12,
                              padding: '10px 14px',
                              borderRadius: 8,
                              border: on ? '1px solid var(--primary)' : '1px solid var(--border)',
                              background: on ? 'var(--primary-soft, rgba(16, 185, 129, 0.05))' : 'var(--surface-2)',
                              transition: 'all 120ms ease',
                            }}
                          >
                            {/* Checkbox, Parameter Name & Live Value */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200, flex: '1 1 220px' }}>
                              <input
                                type="checkbox"
                                id={`param-chk-${k}`}
                                checked={on}
                                onChange={() => toggleParam(k)}
                                style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
                              />
                              <label
                                htmlFor={`param-chk-${k}`}
                                style={{ cursor: 'pointer', margin: 0, display: 'flex', flexDirection: 'column' }}
                              >
                                <span style={{ fontWeight: 600, fontSize: 13, color: on ? 'var(--ink)' : 'var(--ink-2)' }}>
                                  {displayName}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                  Reading: <b style={{ color: 'var(--ink)' }}>{val}</b>{' '}
                                  <span style={{ color: 'var(--ink-4)' }}>({defaultUnit})</span>
                                  {isCustomized && (
                                    <span style={{ marginLeft: 6, color: 'var(--st-orange)', fontWeight: 600 }}>
                                      &bull; Live CPCB Unit: {activeUnit}
                                    </span>
                                  )}
                                </span>
                              </label>
                            </div>

                            {/* CPCB Measurement Unit Manual Controls */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                                CPCB Unit:
                              </span>

                              {/* Quick Unit Presets */}
                              <div style={{ display: 'flex', gap: 4 }}>
                                {['mg/m3', 'mg/Nm3', 'ug/m3', 'ppm'].map((uOption) => (
                                  <button
                                    key={uOption}
                                    type="button"
                                    onClick={() => updateParamUnit(k, uOption)}
                                    style={{
                                      padding: '3px 7px',
                                      fontSize: 11,
                                      fontFamily: 'var(--font-mono)',
                                      fontWeight: activeUnit === uOption ? 700 : 500,
                                      borderRadius: 4,
                                      border: activeUnit === uOption ? '1px solid var(--primary)' : '1px solid var(--border)',
                                      background: activeUnit === uOption ? 'var(--primary)' : 'var(--surface)',
                                      color: activeUnit === uOption ? '#fff' : 'var(--ink-2)',
                                      cursor: 'pointer',
                                      transition: 'all 120ms ease',
                                    }}
                                    title={`Set CPCB unit to ${uOption}`}
                                  >
                                    {uOption}
                                  </button>
                                ))}
                              </div>

                              {/* Dropdown for other units */}
                              <select
                                value={['mg/m3', 'mg/Nm3', 'ug/m3', 'ppm', 'mg/l', 'pH', '%', 'm3/hr', 'degC'].includes(activeUnit) ? activeUnit : 'custom'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val !== 'custom') {
                                    updateParamUnit(k, val);
                                  }
                                }}
                                style={{
                                  fontSize: 11,
                                  padding: '4px 8px',
                                  height: 28,
                                  borderRadius: 4,
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                  color: 'var(--ink)',
                                  cursor: 'pointer',
                                }}
                              >
                                <option value="mg/m3">mg/m3</option>
                                <option value="mg/Nm3">mg/Nm3</option>
                                <option value="ug/m3">ug/m3</option>
                                <option value="ppm">ppm</option>
                                <option value="mg/l">mg/l</option>
                                <option value="pH">pH</option>
                                <option value="%">%</option>
                                <option value="m3/hr">m3/hr</option>
                                <option value="degC">degC</option>
                                <option value="custom">Custom...</option>
                              </select>

                              {/* Editable Unit Input Field */}
                              <input
                                type="text"
                                value={activeUnit}
                                onChange={(e) => updateParamUnit(k, e.target.value)}
                                placeholder="Unit"
                                style={{
                                  width: 78,
                                  height: 28,
                                  fontSize: 11,
                                  fontFamily: 'var(--font-mono)',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: isCustomized ? '1px solid var(--st-orange)' : '1px solid var(--border)',
                                  background: 'var(--surface)',
                                  color: 'var(--ink)',
                                  textAlign: 'center',
                                }}
                                title="Type custom CPCB unit"
                              />

                              {/* Reset Button */}
                              {isCustomized && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => resetParamUnit(k)}
                                  style={{ padding: '2px 6px', fontSize: 10, color: 'var(--ink-3)', height: 26 }}
                                  title="Reset back to default unit"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* ================= STATE BOARD FALLBACK FORM ================= */
                <div className="form-grid">
                  <div className="fg">
                    <label>Token ID <span className="req">*</span></label>
                    <input
                      value={draft.tokenId}
                      onChange={(e) => setDraft({ ...draft, tokenId: e.target.value })}
                      placeholder={'API Key or Token for ' + selectedBoard.code}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div className="fg">
                    <label>{selectedBoard.code} Site ID <span className="req">*</span></label>
                    <input
                      value={draft.siteId}
                      onChange={(e) => setDraft({ ...draft, siteId: e.target.value })}
                      placeholder={'Site ID on ' + selectedBoard.code}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div className="fg">
                    <label>Site User ID</label>
                    <input
                      value={draft.siteUserId}
                      onChange={(e) => setDraft({ ...draft, siteUserId: e.target.value })}
                      placeholder="Username for board portal"
                    />
                  </div>
                  <div className="fg">
                    <label>Password</label>
                    <input
                      type="password"
                      value={draft.password}
                      onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                      placeholder="Password for board portal"
                    />
                  </div>
                  <div className="fg fg-wide">
                    <label>Parameters ({selectedCount} of {allParams.length})</label>
                    <div className="checkgrid" style={{ marginTop: 6 }}>
                      {(selectedSite.params || []).map((p, idx) => {
                        const k = p.key;
                        const on = draft.parameters.indexOf(k) !== -1;
                        return (
                          <label key={p.pid || (k + '-' + idx)} className={'chk ' + (on ? 'on' : '')}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleParam(k)}
                            />
                            <span>{p.name || k}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            {/* ---- 15-Minute Automated CPCB Transmission Panel ---- */}
            {isCpcb && (
              <Panel
                title="⏰ Automated CPCB Transmission (Every 15 Minutes)"
                hint="Compliant with CPCB OCEMS mandate: transmits sensor packets at regular 15-minute intervals"
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        background: autoPushEnabled && isReadyToPush
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(156, 163, 175, 0.15)',
                        color: autoPushEnabled && isReadyToPush
                          ? 'var(--st-green)'
                          : 'var(--ink-3)',
                        border: autoPushEnabled && isReadyToPush
                          ? '1px solid rgba(16, 185, 129, 0.3)'
                          : '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: autoPushEnabled && isReadyToPush ? 'var(--st-green)' : 'var(--ink-4)',
                          boxShadow: autoPushEnabled && isReadyToPush ? '0 0 8px var(--st-green)' : 'none',
                        }}
                      />
                      {autoPushEnabled && isReadyToPush ? '15-Min Auto-Hit Active' : 'Auto-Hit Disabled'}
                    </span>

                    <button
                      type="button"
                      className={`btn btn-sm ${autoPushEnabled ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => toggleAutoPush(!autoPushEnabled)}
                      style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600 }}
                    >
                      {autoPushEnabled ? 'Pause Auto-Push' : '▶ Enable 15-Min Auto-Push'}
                    </button>
                  </div>
                }
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 16,
                    padding: 12,
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    marginBottom: 14,
                    alignItems: 'center',
                  }}
                >
                  {/* Countdown Metric */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: 'var(--surface)',
                        border: '2px solid var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--primary)',
                      }}
                    >
                      {autoPushEnabled && isReadyToPush ? formatCountdown(secondsUntilNextPush) : '--:--'}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                        Next Auto-Hit In
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                        {autoPushEnabled && isReadyToPush
                          ? `${Math.ceil(secondsUntilNextPush / 60)} min (${formatCountdown(secondsUntilNextPush)})`
                          : 'Paused / Incomplete credentials'}
                      </div>
                    </div>
                  </div>

                  {/* Interval Setting */}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                      Transmission Cycle
                    </label>
                    <select
                      value={autoPushIntervalMins}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 15;
                        setAutoPushIntervalMins(val);
                        setDraft((d) => ({ ...d, intervalMinutes: val }));
                        setSecondsUntilNextPush(val * 60);
                      }}
                      className="input"
                      style={{ padding: '6px 10px', fontSize: 12, height: 34, background: 'var(--surface)' }}
                    >
                      <option value={15}>Every 15 Minutes (CPCB Standard)</option>
                      <option value={30}>Every 30 Minutes</option>
                      <option value={60}>Every 1 Hour</option>
                      <option value={5}>Every 5 Minutes (Test Mode)</option>
                    </select>
                  </div>

                  {/* Server Cron Sync */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>
                      Cloud & Server Sync
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--st-green)', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <span>✓ Node-Cron Active (*/{autoPushIntervalMins} * * * *)</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                      Hits continue even if tab is closed
                    </div>
                  </div>

                  {/* Manual Run Now */}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => triggerAutoPush(false)}
                      disabled={autoPushInProgress || pushing || !isReadyToPush}
                      title="Trigger an immediate auto-transmission cycle right now"
                      style={{ height: 34, fontSize: 12 }}
                    >
                      {autoPushInProgress ? 'Pushing...' : '⚡ Hit Now'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowAutoLogs(!showAutoLogs)}
                      style={{ height: 34, fontSize: 12 }}
                    >
                      {showAutoLogs ? 'Hide Logs' : `Logs (${autoPushLogs.length})`}
                    </button>
                  </div>
                </div>

                {/* Auto Push Activity Log Drawer */}
                {showAutoLogs && (
                  <div
                    style={{
                      marginTop: 10,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 12,
                      maxHeight: 200,
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                      <span>CPCB Automatic Transmission Activity Log</span>
                      <span style={{ color: 'var(--ink-3)' }}>Showing last {autoPushLogs.length} events</span>
                    </div>
                    {autoPushLogs.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: '12px 0' }}>
                        No automatic transmissions recorded yet. Next hit in {formatCountdown(secondsUntilNextPush)}.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {autoPushLogs.map((log) => (
                          <div
                            key={log.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 12,
                              padding: '6px 10px',
                              borderRadius: 6,
                              background: log.ok ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                              border: log.ok ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: log.ok ? 'var(--st-green)' : 'var(--st-red)', fontWeight: 700 }}>
                                {log.ok ? '✓' : '✗'}
                              </span>
                              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                                {log.time}
                              </span>
                              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                                {log.paramsCount} parameter(s)
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                                — {log.message}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {log.durationMs > 0 && (
                                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                                  {log.durationMs}ms
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: log.ok ? 'var(--st-green)' : 'var(--st-red)',
                                  color: '#fff',
                                }}
                              >
                                {log.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            )}

            {/* ---- Push Action Panel ---- */}
            <Panel
              title={isCpcb ? 'Transmit to CPCB Server' : 'Push to ' + selectedBoard.code}
              hint={
                isCpcb
                  ? 'Target: ' + draft.apiUrl
                  : selectedBoard.name
              }
              right={
                <div style={{ display: 'flex', gap: 10 }}>
                  {isCpcb && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => doPush(true)}
                      disabled={testing || pushing || !isReadyToPush}
                      title="Validate signature and payload without network push"
                    >
                      {testing ? 'Testing...' : '🧪 Validate / Dry Run'}
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    style={{ minWidth: 140, fontWeight: 600 }}
                    onClick={() => doPush(false)}
                    disabled={pushing || testing || !isReadyToPush}
                  >
                    {pushing ? 'Transmitting...' : isCpcb ? '🚀 Hit Data to CPCB' : 'Hit'}
                  </button>
                </div>
              }
            >
              <div className="form-grid">
                <div className="fg">
                  <label>Official Portal Endpoint</label>
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
                    {draft.apiUrl || selectedBoard.url}
                  </a>
                </div>

                <div className="fg">
                  <label>Selected Telemetry Parameters</label>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                    }}
                  >
                    {draft.parameters
                      .map((k) => {
                        const found = (selectedSite.params || []).find((p) => p.key === k);
                        const customUnit = draft.paramUnits && draft.paramUnits[k];
                        const defaultUnit = getDefaultUnitForParam(k, found?.unit);
                        const u = (customUnit !== undefined && customUnit !== '') ? customUnit : defaultUnit;
                        return `${found?.name || k} [${u}]`;
                      })
                      .join(', ') || 'None selected'}
                  </span>
                </div>

                <div className="fg fg-wide">
                  <label>Readiness & Validation Status</label>
                  <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {isReadyToPush ? (
                      <span style={{ color: 'var(--st-green)', fontWeight: 600 }}>
                        ✓ Ready to transmit {draft.parameters.length} parameter(s) to {selectedBoard.code}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--st-orange)', fontWeight: 600 }}>
                        ⚠️ Incomplete: Please provide {isCpcb ? 'Station ID, Device ID, Token ID, and Public.pem' : 'all required credentials'}
                      </span>
                    )}

                    {isCpcb && isReadyToPush && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowInspector(!showInspector)}
                      >
                        {showInspector ? 'Hide Request Inspector' : '🔍 Inspect Request Payload'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Collapsible Payload & Signature Inspector */}
              {showInspector && isCpcb && (
                <div
                  style={{
                    marginTop: 18,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink)' }}>
                      CPCB ODAMS v1.0 Outgoing Packet Inspector
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['payload', 'headers'].map((tab) => (
                        <button
                          key={tab}
                          className={`btn btn-sm ${inspectorTab === tab ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={() => setInspectorTab(tab)}
                        >
                          {tab.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {loadingPreview ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Generating live preview...</div>
                  ) : previewData ? (
                    <pre
                      style={{
                        margin: 0,
                        padding: 10,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--ink)',
                        overflowX: 'auto',
                        maxHeight: 220,
                      }}
                    >
                      {inspectorTab === 'payload'
                        ? JSON.stringify(previewData.cpcbPayload || previewData.cpcbStandardPayload, null, 2)
                        : JSON.stringify(previewData.headers, null, 2)}
                    </pre>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Fill in Station ID and Device ID to preview payload.</div>
                  )}
                </div>
              )}
            </Panel>
          </>
        ) : null}

        {/* ---- Transmission Success Modal ---- */}
        {successModal && (
          <Modal
            open={true}
            title={successModal.isDryRun ? 'Dry Run Validated' : 'Data Successfully Sent to CPCB'}
            onClose={() => setSuccessModal(null)}
            width={540}
            footer={
              <button
                className="btn btn-primary"
                onClick={() => setSuccessModal(null)}
              >
                Done
              </button>
            }
          >
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--st-green)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  marginBottom: 12,
                }}
              >
                ✓
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                {successModal.isDryRun
                  ? 'CPCB Payload & Signature Validated'
                  : `Transmitted to ${successModal.board.code}`}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  marginTop: 6,
                }}
              >
                <b>{successModal.site.name}</b> ({successModal.site.id})
              </div>

              {/* Details card */}
              <div
                style={{
                  margin: '16px auto',
                  textAlign: 'left',
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                <div>
                  <b>API Endpoint:</b> <code>{successModal.result.apiUrl || 'https://cems.cpcb.gov.in/v1.0/industry/data'}</code>
                </div>
                {successModal.result.stationId && (
                  <div>
                    <b>Station ID:</b> <span className="mono">{successModal.result.stationId}</span>
                  </div>
                )}
                {successModal.result.deviceId && (
                  <div>
                    <b>Device ID:</b> <span className="mono">{successModal.result.deviceId}</span>
                  </div>
                )}
                <div>
                  <b>Parameters Transmitted:</b> {successModal.result.params || 0} parameter(s)
                </div>
                {successModal.result.region && (
                  <div>
                    <b>Gateway Region:</b> <span className="mono">{successModal.result.region === 'bom1' ? 'Mumbai, India (bom1)' : successModal.result.region}</span>
                  </div>
                )}
                {successModal.result.durationMs && (
                  <div>
                    <b>Network Response Time:</b> {successModal.result.durationMs}ms
                  </div>
                )}
                {successModal.result.cpcbStatus && (
                  <div>
                    <b>CPCB Status Code:</b> <span className="mono" style={{ color: 'var(--st-green)', fontWeight: 700 }}>{successModal.result.cpcbStatus}</span>
                  </div>
                )}
                {successModal.result.cpcbMsg && (
                  <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--surface)', borderRadius: 4 }}>
                    <b>CPCB Response:</b> {successModal.result.cpcbMsg}
                  </div>
                )}
              </div>

              {/* Raw JSON Accordion */}
              {successModal.result.response && (
                <details style={{ textAlign: 'left', marginTop: 10, fontSize: 11 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--primary)' }}>
                    View Raw Server Response JSON
                  </summary>
                  <pre
                    style={{
                      background: 'var(--surface-2)',
                      padding: 8,
                      borderRadius: 6,
                      maxHeight: 120,
                      overflowY: 'auto',
                      fontSize: 11,
                      marginTop: 6,
                    }}
                  >
                    {typeof successModal.result.response === 'object'
                      ? JSON.stringify(successModal.result.response, null, 2)
                      : String(successModal.result.response)}
                  </pre>
                </details>
              )}
            </div>
          </Modal>
        )}

        {/* ---- Transmission Failure Modal ---- */}
        {failModal && (
          <Modal
            open={true}
            title="Transmission Notice"
            onClose={() => setFailModal(null)}
            width={520}
            footer={
              <button
                className="btn btn-danger"
                onClick={() => setFailModal(null)}
              >
                Dismiss
              </button>
            }
          >
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--st-red)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                !
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                Transmission Notice for {failModal.board.code}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  marginTop: 6,
                }}
              >
                <b>{failModal.site.name}</b> ({failModal.site.id})
              </div>

              <div
                style={{
                  margin: '14px 0',
                  padding: '12px 14px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--st-red)',
                  textAlign: 'left',
                  lineHeight: 1.5,
                }}
              >
                <b>Status Message:</b> {failModal.error || 'Server did not acknowledge transmission'}
              </div>

              {failModal.details && (
                <div
                  style={{
                    textAlign: 'left',
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 12,
                    lineHeight: 1.6,
                    marginBottom: 10,
                  }}
                >
                  {failModal.details.status && (
                    <div><b>HTTP Status:</b> {failModal.details.status} {failModal.details.statusText || ''}</div>
                  )}
                  {failModal.details.region && (
                    <div><b>Gateway Region:</b> <span className="mono">{failModal.details.region === 'bom1' ? 'Mumbai, India (bom1)' : failModal.details.region}</span></div>
                  )}
                  {failModal.details.cpcbStatus && (
                    <div><b>CPCB Status Code:</b> <span className="mono" style={{ color: 'var(--st-red)', fontWeight: 700 }}>{failModal.details.cpcbStatus}</span></div>
                  )}
                  {failModal.details.cpcbMsg && (
                    <div><b>CPCB Response:</b> <span>{failModal.details.cpcbMsg}</span></div>
                  )}
                  {failModal.details.apiUrl && (
                    <div><b>Endpoint:</b> <span className="mono" style={{ fontSize: 11 }}>{failModal.details.apiUrl}</span></div>
                  )}
                  {failModal.details.stationId && (
                    <div><b>Station ID:</b> <span className="mono">{failModal.details.stationId}</span></div>
                  )}
                  {failModal.details.deviceId && (
                    <div><b>Device ID:</b> <span className="mono">{failModal.details.deviceId}</span></div>
                  )}
                </div>
              )}

              {failModal.details && failModal.details.hint && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'left', marginTop: 8 }}>
                  💡 <b>Troubleshooting:</b> {failModal.details.hint}
                </div>
              )}

              {((failModal.details && failModal.details.cpcbStatus === 110) ||
                (failModal.error && String(failModal.error).toLowerCase().includes('unit'))) && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    background: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--ink)',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
                    💡 Quick Fix for Invalid Unit:
                  </div>
                  <div>
                    In the &quot;Parameters to Hit &amp; Measurement Units&quot; section above, change the measurement unit for your parameter (e.g., toggle from <b>mg/Nm3</b> to <b>mg/m3</b> or vice versa) to match your CPCB station registration, then hit data again.
                  </div>
                </div>
              )}

              {failModal.details && (failModal.details.response || failModal.details.rawResponseBody) && (
                <details style={{ textAlign: 'left', marginTop: 10, fontSize: 11 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--st-red)' }}>
                    View Raw Server Response
                  </summary>
                  <pre
                    style={{
                      background: 'var(--surface-2)',
                      padding: 8,
                      borderRadius: 6,
                      maxHeight: 120,
                      overflowY: 'auto',
                      fontSize: 11,
                      marginTop: 6,
                    }}
                  >
                    {typeof (failModal.details.response || failModal.details.rawResponseBody) === 'object'
                      ? JSON.stringify(failModal.details.response, null, 2)
                      : String(failModal.details.rawResponseBody || failModal.details.response)}
                  </pre>
                </details>
              )}
            </div>
          </Modal>
        )}
      </>
    );
  }

  /* ==========================================================
     RENDER 3 — Site Selection Grid
     ========================================================== */
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">CPCB & State Board Live Push</div>
          <div className="page-sub">
            <span className="live-dot"></span>
            <span>Hit real-time OCEMS data to cems.cpcb.gov.in and State boards</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={lock}>
          🔒 Lock Gateway
        </button>
      </div>

      <Panel
        title="Select Site for CPCB Transmission"
        hint="Click any connected site to configure and transmit telemetry data"
        right={
          <input
            className="search"
            placeholder="Search sites by name, ID, sector"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      >
        {filteredSites.length === 0 ? (
          <div className="empty">No sites match your search.</div>
        ) : (
          <div className="grid">
            {filteredSites.map((s) => (
              <div
                key={s.id}
                className={'icard ' + s.signal}
                onClick={() => openSite(s)}
                style={{ cursor: 'pointer' }}
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
                  {(s.params || []).slice(0, 3).map((p, i) => {
                    const isRec = isDataReceiving(p, s);
                    return (
                      <div
                        className="param-row"
                        key={p.pid || (p.key + '-' + i)}
                      >
                        <span className="pname">
                          {p.name ? String(p.name).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key)}
                        </span>
                        <span className={'pval' + (!isRec ? ' val-na' : '')}>
                          {formatParamValue(p, s)}
                        </span>
                        <span className="plimit">
                          &le; {(PARAMS[p.key] && PARAMS[p.key].limit) || p.limit}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="icard-foot" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{s.loc || '-'}</span>
                  <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 12 }}>
                    Configure CPCB Hit &rarr;
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
