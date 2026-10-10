import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
    paramTokens: {},         // separate token details per parameter: { [paramKey]: { tokenId, deviceId, stationId } }
  };
}

/* CPCB default measurement units for Live page transmission (PM strictly defaults to mg/m³) */
function getDefaultUnitForParam(paramKey, originalUnit) {
  const norm = (paramKey || '').toLowerCase();
  if (norm === 'pm' || norm === 'p-pm' || norm.includes('pm') || norm.includes('particulate') || norm.includes('dust') || norm.includes('spm') || norm.includes('stack')) {
    return 'mg/m³'; // Exactly matching CPCB ODAMS portal registration: 0 - 50 mg/m³
  }
  if (norm === 'so2' || norm === 'nox' || norm === 'co' || norm === 'sox') return originalUnit || 'mg/Nm³';
  if (norm === 'cod' || norm === 'bod' || norm === 'tss') return originalUnit || 'mg/l';
  if (norm === 'ph') return 'pH';
  if (norm === 'flow') return originalUnit || 'm3/hr';
  if (norm === 'temp' || norm === 'temperature') return 'degC';
  return originalUnit || 'mg/m³';
}

function formatIstDate(dateVal) {
  if (!dateVal) return 'Never';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return String(dateVal);
  }
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
  const [cloudPushInfo, setCloudPushInfo] = useState(null); // { at, status, msg } fetched live from database

  const [query, setQuery] = useState('');
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('payload'); // 'payload' | 'headers' | 'signature'
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [successModal, setSuccessModal] = useState(null);
  const [failModal, setFailModal] = useState(null);

  /* Multi-Board (Simultaneous) Regulatory Dispatch State */
  const [isMultiBoardMode, setIsMultiBoardMode] = useState(false);
  const [multiSelectedBoardCodes, setMultiSelectedBoardCodes] = useState(['CPCB']);
  const [dbBoards, setDbBoards] = useState([]);
  const [multiPushModal, setMultiPushModal] = useState(null);

  /* Multi-Site Regulatory Overview State */
  const [showMultiSiteModal, setShowMultiSiteModal] = useState(false);
  const [multiSiteConfigs, setMultiSiteConfigs] = useState([]);
  const [loadingMultiSite, setLoadingMultiSite] = useState(false);
  const [triggeringAll, setTriggeringAll] = useState(false);
  const [openParamTokenEditors, setOpenParamTokenEditors] = useState({});

  const [allCreds, setAllCreds] = useState(loadAllCreds());
  const [draft, setDraft] = useState(emptyCreds());

  const fileInputRef = useRef(null);
  const lastAutoPushedSlotRef = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selectedSiteRef = useRef(selectedSite);
  selectedSiteRef.current = selectedSite;
  const selectedBoardRef = useRef(selectedBoard);
  selectedBoardRef.current = selectedBoard;
  const isMultiBoardModeRef = useRef(isMultiBoardMode);
  isMultiBoardModeRef.current = isMultiBoardMode;
  const multiSelectedBoardCodesRef = useRef(multiSelectedBoardCodes);
  multiSelectedBoardCodesRef.current = multiSelectedBoardCodes;
  const allCredsRef = useRef(allCreds);
  allCredsRef.current = allCreds;
  const isPushingRef = useRef(false);
  isPushingRef.current = pushing || autoPushInProgress || testing;

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

    const siteKeyId = selectedSite.siteCode || selectedSite.id;
    const key = siteKeyId + '|' + selectedBoard.code;
    const saved = allCreds[key] || allCreds[selectedSite.id + '|' + selectedBoard.code] || emptyCreds();
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

    // Attempt loading server-persisted configuration from database
    const loadFromDb = async () => {
      try {
        const querySiteId = selectedSite.siteCode || selectedSite.id;
        if (api.getBoardConfigs) {
          const res = await api.getBoardConfigs(querySiteId);
          if (res && res.boards && Array.isArray(res.boards)) {
            setDbBoards(res.boards);
          }
          const found = res && res.boards && res.boards.find((b) => b.boardCode === selectedBoard.code);
          if (found && (found.stationId || found.tokenId)) {
            setDraft((prev) => ({
              ...prev,
              apiUrl: found.apiUrl || prev.apiUrl,
              stationId: found.stationId || prev.stationId,
              deviceId: found.deviceId || prev.deviceId,
              tokenId: found.tokenId || prev.tokenId,
              publicKeyPem: found.publicKeyPem || prev.publicKeyPem,
              publicKeyFileName: found.publicKeyFileName || prev.publicKeyFileName,
              parameters: found.parameters && found.parameters.length ? found.parameters : prev.parameters,
              paramUnits: found.paramUnits ? { ...(prev.paramUnits || {}), ...found.paramUnits } : prev.paramUnits,
              paramTokens: found.paramTokens || found.param_tokens || prev.paramTokens || {},
              autoPush: found.autoPush !== undefined ? Boolean(found.autoPush) : prev.autoPush,
              intervalMinutes: Number(found.intervalMinutes) || prev.intervalMinutes,
            }));
            if (found.autoPush !== undefined) setAutoPushEnabled(Boolean(found.autoPush));
            if (found.intervalMinutes) {
              const mins = Number(found.intervalMinutes) || 15;
              setAutoPushIntervalMins(mins);
            }
            if (found.lastPushedAt) {
              setCloudPushInfo({
                at: found.lastPushedAt,
                status: found.lastPushStatus,
                msg: found.lastPushMsg,
              });
            }
            return;
          }
        }

        // Fallback to CPCB config
        if (selectedBoard.code === 'CPCB' && api.getCpcbConfig) {
          const res = await api.getCpcbConfig(querySiteId);
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
              paramTokens: res.config.paramTokens || res.config.param_tokens || prev.paramTokens || {},
              autoPush: res.config.autoPush !== undefined ? Boolean(res.config.autoPush) : prev.autoPush,
              intervalMinutes: Number(res.config.intervalMinutes) || prev.intervalMinutes,
            }));
            if (res.config.autoPush !== undefined) setAutoPushEnabled(Boolean(res.config.autoPush));
            if (res.config.lastPushedAt) {
              setCloudPushInfo({
                at: res.config.lastPushedAt,
                status: res.config.lastPushStatus,
                msg: res.config.lastPushMsg,
              });
            }
          }
        }
      } catch (e) {}
    };

    loadFromDb();
  }, [selectedSite, selectedBoard, allCreds]);

  /* ------------------------------------------------------------
     Cloud Status Polling: Periodically refresh database sync
     ------------------------------------------------------------ */
  const refreshCloudStatus = useCallback(async () => {
    if (!selectedSite) return;
    try {
      const siteKeyId = selectedSite.siteCode || selectedSite.id;
      if (api.getBoardConfigs) {
        const res = await api.getBoardConfigs(siteKeyId);
        if (res && res.boards && Array.isArray(res.boards)) {
          setDbBoards(res.boards);
        }
        const found = res && res.boards && res.boards.find((b) => b.boardCode === (selectedBoard?.code || 'CPCB'));
        if (found && found.lastPushedAt) {
          setCloudPushInfo({
            at: found.lastPushedAt,
            status: found.lastPushStatus,
            msg: found.lastPushMsg,
          });
        }
      }
    } catch {}
  }, [selectedSite, selectedBoard]);

  useEffect(() => {
    if (!selectedSite) return;
    const pollId = setInterval(refreshCloudStatus, 20000);
    return () => clearInterval(pollId);
  }, [selectedSite, refreshCloudStatus]);

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

  const persistCreds = async (silent = false) => {
    if (!selectedSite || !selectedBoard) return;
    const siteKeyId = selectedSite.siteCode || selectedSite.id;
    const key = siteKeyId + '|' + selectedBoard.code;
    const next = Object.assign({}, allCreds);
    next[key] = Object.assign({}, draft);
    setAllCreds(next);
    saveAllCreds(next);

    // Persist to 24/7 Cloud PostgreSQL Database for this board
    const isAutoOn = autoPushEnabled && draft.autoPush !== false;
    try {
      if (api.saveBoardConfig) {
        await api.saveBoardConfig(siteKeyId, {
          ...draft,
          boardCode: selectedBoard.code,
          boardName: selectedBoard.name,
          autoPush: isAutoOn,
          action: isAutoOn ? 'start' : 'stop',
          paramTokens: draft.paramTokens || {},
        });
      } else if (selectedBoard.code === 'CPCB' && api.saveCpcbConfig) {
        await api.saveCpcbConfig(siteKeyId, {
          ...draft,
          autoPush: isAutoOn,
          action: isAutoOn ? 'start' : 'stop',
          paramTokens: draft.paramTokens || {},
        });
      }
      if (!silent) {
        if (isAutoOn) {
          toast.success(`⚡ Saved to 24/7 Cloud Database for ${selectedBoard.code} · Cron Active`);
        } else {
          toast(`🛑 Saved to 24/7 Cloud Database for ${selectedBoard.code} · Transmission Stopped`);
        }
      }
      refreshCloudStatus();
    } catch (e) {
      if (!silent) toast.error(`Local save complete, DB sync: ${e.message}`);
    }
  };

  // Auto-save debounce: when user enters/edits details to hit data, automatically persist to DB & cron
  useEffect(() => {
    if (!selectedSite || !selectedBoard) return;
    const hasCreds = Boolean(
      draft.stationId?.trim() &&
      draft.deviceId?.trim() &&
      draft.tokenId?.trim() &&
      draft.publicKeyPem?.trim()
    );
    if (!hasCreds) return;

    const timer = setTimeout(() => {
      persistCreds(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    selectedSite,
    selectedBoard,
    draft.stationId,
    draft.deviceId,
    draft.tokenId,
    draft.publicKeyPem,
    draft.parameters,
    draft.paramUnits,
    draft.apiUrl,
  ]);

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

  /* Parameter-specific token helpers for multi-parameter CPCB cases */
  const toggleParamTokenEditor = (paramKey) => {
    setOpenParamTokenEditors((prev) => ({
      ...prev,
      [paramKey]: !prev[paramKey],
    }));
  };

  const updateParamTokenField = (paramKey, field, val) => {
    setDraft((prev) => {
      const current = prev.paramTokens && prev.paramTokens[paramKey] ? { ...prev.paramTokens[paramKey] } : {};
      current[field] = val;
      return {
        ...prev,
        paramTokens: {
          ...(prev.paramTokens || {}),
          [paramKey]: current,
        },
      };
    });
  };

  const removeParamTokenOverride = (paramKey) => {
    setDraft((prev) => {
      const next = { ...(prev.paramTokens || {}) };
      delete next[paramKey];
      return {
        ...prev,
        paramTokens: next,
      };
    });
    setOpenParamTokenEditors((prev) => ({ ...prev, [paramKey]: false }));
    toast(`Reverted ${paramKey} to default board credentials`);
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

  /* ==========================================================
     Multi-Board (Simultaneous) Operations & Helpers
     ========================================================== */
  const checkBoardConfigured = useCallback((boardCode) => {
    if (!selectedSite) return false;
    // Active draft in memory?
    if (selectedBoard && selectedBoard.code === boardCode) {
      if (boardCode === 'CPCB') {
        return Boolean(draft.stationId?.trim() && draft.deviceId?.trim() && draft.tokenId?.trim() && draft.publicKeyPem?.trim());
      }
      return Boolean(draft.tokenId?.trim() && (draft.stationId?.trim() || draft.siteId?.trim()));
    }
    // Saved in cloud PostgreSQL?
    const dbMatch = (dbBoards || []).find((b) => b.boardCode === boardCode);
    if (dbMatch) {
      if (boardCode === 'CPCB') {
        if (dbMatch.stationId?.trim() && dbMatch.deviceId?.trim() && dbMatch.tokenId?.trim() && dbMatch.publicKeyPem?.trim()) {
          return true;
        }
      } else {
        if (dbMatch.tokenId?.trim() && (dbMatch.stationId?.trim() || dbMatch.siteId?.trim())) {
          return true;
        }
      }
    }
    // Saved in localStorage allCreds?
    const siteKeyId = selectedSite.siteCode || selectedSite.id;
    const saved = allCreds[siteKeyId + '|' + boardCode] || allCreds[selectedSite.id + '|' + boardCode];
    if (saved) {
      if (boardCode === 'CPCB') {
        return Boolean(saved.stationId?.trim() && saved.deviceId?.trim() && saved.tokenId?.trim() && saved.publicKeyPem?.trim());
      }
      return Boolean(saved.tokenId?.trim() && (saved.stationId?.trim() || saved.siteId?.trim()));
    }
    return false;
  }, [selectedSite, selectedBoard, draft, dbBoards, allCreds]);

  /* Safely switch active board without losing current draft inputs */
  const switchActiveBoard = (newBoard) => {
    if (!newBoard || newBoard.code === selectedBoard?.code) return;
    if (selectedSite) {
      const siteKeyId = selectedSite.siteCode || selectedSite.id;
      const currentKey = siteKeyId + '|' + selectedBoard.code;
      const updatedCreds = {
        ...allCreds,
        [currentKey]: { ...draft },
      };
      setAllCreds(updatedCreds);
      saveAllCreds(updatedCreds);
    }
    setSelectedBoard(newBoard);
  };

  /* Toggle individual board in multi-selection */
  const toggleMultiBoard = (boardCode) => {
    setMultiSelectedBoardCodes((prev) => {
      const exists = prev.includes(boardCode);
      if (exists) {
        if (prev.length === 1) {
          toast('At least one pollution board must remain selected.');
          return prev;
        }
        return prev.filter((c) => c !== boardCode);
      } else {
        return [...prev, boardCode];
      }
    });
  };

  const selectAllBoards = () => {
    setMultiSelectedBoardCodes(BOARDS.map((b) => b.code));
  };

  const selectCpcbAndSpcb = () => {
    const siteState = (selectedSite?.state || '').toLowerCase();
    let spcbCode = 'HSPCB';
    if (siteState.includes('delhi')) spcbCode = 'DPCC';
    else if (siteState.includes('rajasthan')) spcbCode = 'RJSPCB';
    else if (siteState.includes('punjab')) spcbCode = 'PPCB';
    else if (siteState.includes('uttar') || siteState.includes('up')) spcbCode = 'UPPCB';
    setMultiSelectedBoardCodes(Array.from(new Set(['CPCB', spcbCode])));
  };

  const getCredsForBoard = (boardCode) => {
    if (selectedBoard && selectedBoard.code === boardCode) {
      return { ...draft };
    }
    const siteKeyId = selectedSite.siteCode || selectedSite.id;
    const saved = allCreds[siteKeyId + '|' + boardCode] || allCreds[selectedSite.id + '|' + boardCode] || {};
    const dbMatch = (dbBoards || []).find((b) => b.boardCode === boardCode) || {};
    return {
      ...emptyCreds(),
      ...saved,
      ...(dbMatch.stationId || dbMatch.tokenId ? {
        stationId: dbMatch.stationId || saved.stationId || '',
        deviceId: dbMatch.deviceId || saved.deviceId || '',
        tokenId: dbMatch.tokenId || saved.tokenId || '',
        publicKeyPem: dbMatch.publicKeyPem || saved.publicKeyPem || '',
        publicKeyFileName: dbMatch.publicKeyFileName || saved.publicKeyFileName || '',
        apiUrl: dbMatch.apiUrl || saved.apiUrl || '',
        siteId: dbMatch.siteId || dbMatch.stationId || saved.siteId || '',
        siteUserId: dbMatch.siteUserId || saved.siteUserId || '',
        password: dbMatch.password || saved.password || '',
        parameters: dbMatch.parameters && dbMatch.parameters.length ? dbMatch.parameters : saved.parameters,
        paramUnits: dbMatch.paramUnits || saved.paramUnits || {},
        autoPush: dbMatch.autoPush !== undefined ? Boolean(dbMatch.autoPush) : saved.autoPush,
        intervalMinutes: dbMatch.intervalMinutes || saved.intervalMinutes || 15,
      } : {}),
    };
  };

  const copyCredsFromCpcb = () => {
    if (!selectedSite) return;
    const siteKeyId = selectedSite.siteCode || selectedSite.id;
    const cpcbKey = siteKeyId + '|CPCB';
    const cpcbCreds = allCreds[cpcbKey] || (dbBoards || []).find((b) => b.boardCode === 'CPCB') || (selectedBoard.code === 'CPCB' ? draft : {});

    const cpcbStation = cpcbCreds.stationId || (selectedBoard.code === 'CPCB' ? draft.stationId : '');
    const cpcbToken = cpcbCreds.tokenId || (selectedBoard.code === 'CPCB' ? draft.tokenId : '');
    const cpcbDevice = cpcbCreds.deviceId || (selectedBoard.code === 'CPCB' ? draft.deviceId : '');
    const cpcbPem = cpcbCreds.publicKeyPem || (selectedBoard.code === 'CPCB' ? draft.publicKeyPem : '');
    const cpcbPemName = cpcbCreds.publicKeyFileName || (selectedBoard.code === 'CPCB' ? draft.publicKeyFileName : '');

    if (!cpcbStation && !cpcbToken) {
      toast.error('CPCB credentials are not configured yet. Configure CPCB first.');
      return;
    }

    setDraft((prev) => ({
      ...prev,
      stationId: cpcbStation || prev.stationId,
      deviceId: cpcbDevice || prev.deviceId,
      tokenId: cpcbToken || prev.tokenId,
      publicKeyPem: cpcbPem || prev.publicKeyPem,
      publicKeyFileName: cpcbPemName || prev.publicKeyFileName,
      parameters: (cpcbCreds.parameters && cpcbCreds.parameters.length) ? cpcbCreds.parameters : prev.parameters,
      paramUnits: cpcbCreds.paramUnits ? { ...cpcbCreds.paramUnits } : prev.paramUnits,
    }));
    toast.success(`Copied OCEMS credentials from CPCB to ${selectedBoard.code}`);
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
      // Ensure credentials are permanently saved to database with autoPush: true so 15-minute cron starts working immediately
      if (!isDryRun) {
        persistCreds(true).catch(() => {});
      }

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

      const siteKeyId = selectedSite.siteCode || selectedSite.id;

      const payload = {
        siteId: siteKeyId,
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
        paramTokens: draft.paramTokens || {},
        autoPush: draft.autoPush !== false,
        dryRun: Boolean(isDryRun),
        // Legacy fallback fields for state boards
        boardSiteId: draft.siteId || draft.stationId,
        siteUserId: draft.siteUserId,
        password: draft.password,
        token: getUnlock() ? getUnlock().token : null,
      };

      const result = await api.livePush(payload);
      refreshCloudStatus();

      const logEntry = {
        id: Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        time: new Date().toLocaleTimeString(),
        ok: Boolean(result && result.ok),
        status: result?.cpcbStatus !== undefined ? result.cpcbStatus : (result?.status || (result?.ok ? 200 : 422)),
        paramsCount: paramDetails.length,
        durationMs: result?.durationMs || 0,
        message: (result && (result.cpcbMsg || result.msg)) || (result && result.ok ? 'Data accepted by CPCB' : (result && result.error) || 'Response received'),
      };
      setAutoPushLogs((prev) => [logEntry, ...prev.slice(0, 24)]);

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
          toast.success(`Data transmitted to ${selectedBoard.code} (Status: 200 OK)`);
          setSuccessModal({
            isDryRun: false,
            site: selectedSite,
            board: selectedBoard,
            draft: draft,
            result: result,
          });
        }
      } else {
        const errorMsg = (result && result.cpcbMsg) || (result && result.error) || 'CPCB transmission notice';
        if (result?.cpcbStatus === 111) {
          toast('CPCB Status 111: ODAMS accepts data strictly at 15-minute boundaries (:00, :15, :30, :45). Scheduler will transmit automatically when the timer reaches 00:00.', { icon: 'ℹ️', duration: 6000 });
        } else {
          toast.error(errorMsg);
        }
        setFailModal({
          site: selectedSite,
          board: selectedBoard,
          error: errorMsg,
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

  /* Simultaneous Multi-Board Hit / Push Handler */
  const doMultiPush = async (isDryRun = false, isAuto = false) => {
    if (!selectedSite) return;
    if (!multiSelectedBoardCodes.length) {
      toast.error('Please select at least one pollution control board.');
      return;
    }

    const siteKeyId = selectedSite.siteCode || selectedSite.id;
    const currentKey = siteKeyId + '|' + selectedBoard.code;
    const nextCreds = {
      ...allCreds,
      [currentKey]: { ...draft },
    };
    setAllCreds(nextCreds);
    saveAllCreds(nextCreds);

    if (isDryRun) setTesting(true);
    else setPushing(true);

    const results = [];
    const timeStr = new Date().toLocaleTimeString();

    try {
      for (const boardCode of multiSelectedBoardCodes) {
        const boardObj = BOARDS.find((b) => b.code === boardCode) || {
          code: boardCode,
          name: boardCode,
          url: 'https://cems.cpcb.gov.in/v1.0/industry/data',
        };
        const boardCreds = (boardCode === selectedBoard.code) ? draft : getCredsForBoard(boardCode);

        // Validation for this board
        const hasMinCreds = Boolean(
          boardCreds.tokenId?.trim() &&
          (boardCreds.stationId?.trim() || boardCreds.siteId?.trim())
        );

        if (!hasMinCreds) {
          results.push({
            board: boardObj,
            ok: false,
            status: 'UNCONFIGURED',
            msg: `Missing credentials for ${boardCode}. Token ID and Station ID are required.`,
            skipped: true,
            durationMs: 0,
          });
          continue;
        }

        const paramsToUse = (boardCreds.parameters && boardCreds.parameters.length)
          ? boardCreds.parameters
          : (draft.parameters && draft.parameters.length ? draft.parameters : (selectedSite.params || []).map((p) => p.key));

        const paramDetails = paramsToUse.map((k) => {
          const found = (selectedSite.params || []).find((p) => p.key === k) || {};
          const customUnit = (boardCreds.paramUnits && boardCreds.paramUnits[k]) || (draft.paramUnits && draft.paramUnits[k]);
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
          siteId: siteKeyId,
          board: boardCode,
          apiUrl: boardCreds.apiUrl || boardObj.url,
          stationId: boardCreds.stationId || boardCreds.siteId,
          deviceId: boardCreds.deviceId,
          tokenId: boardCreds.tokenId,
          publicKeyPem: boardCreds.publicKeyPem,
          publicKeyFileName: boardCreds.publicKeyFileName,
          payloadMode: boardCreds.payloadMode || 'standard',
          parameters: paramDetails,
          paramUnits: boardCreds.paramUnits || draft.paramUnits || {},
          dryRun: Boolean(isDryRun),
          boardSiteId: boardCreds.siteId || boardCreds.stationId,
          siteUserId: boardCreds.siteUserId,
          password: boardCreds.password,
          token: getUnlock() ? getUnlock().token : null,
          isAuto: Boolean(isAuto),
        };

        const start = Date.now();
        try {
          const res = await api.livePush(payload);
          const durationMs = Date.now() - start;
          const isOk = Boolean(res && res.ok);

          // Auto-persist to DB if not dry run
          if (!isDryRun && api.saveBoardConfig) {
            api.saveBoardConfig(siteKeyId, {
              ...boardCreds,
              boardCode: boardCode,
              boardName: boardObj.name,
              autoPush: boardCreds.autoPush !== false,
            }).catch(() => {});
          }

          results.push({
            board: boardObj,
            ok: isOk,
            status: res?.cpcbStatus !== undefined ? res.cpcbStatus : (isOk ? 200 : (res?.status || 400)),
            msg: res?.cpcbMsg || res?.error || res?.message || (isOk ? 'Transmitted successfully' : 'Response code error'),
            durationMs: res?.durationMs || durationMs,
            paramsCount: paramDetails.length,
            result: res,
          });
        } catch (err) {
          results.push({
            board: boardObj,
            ok: false,
            status: 500,
            msg: err.message || 'Network dispatch failed',
            durationMs: Date.now() - start,
            paramsCount: paramDetails.length,
            error: err.message,
          });
        }
      }

      // Record every board transmission in the Live Activity Log
      results.forEach((r) => {
        setAutoPushLogs((prev) => [
          {
            id: Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            time: timeStr,
            ok: r.ok,
            status: r.status,
            board: r.board?.code,
            paramsCount: r.paramsCount || 1,
            durationMs: r.durationMs || 0,
            message: `[${r.board?.code}] ${r.msg}`,
          },
          ...prev.slice(0, 24),
        ]);
      });

      refreshCloudStatus();

      const successCount = results.filter((r) => r.ok).length;
      if (successCount === results.length) {
        toast.success(
          isDryRun
            ? `All ${results.length} boards validated successfully!`
            : `🚀 Data successfully transmitted to all ${results.length} boards!`
        );
      } else if (successCount > 0) {
        toast(
          `Dispatched to ${results.length} boards: ${successCount} successful, ${results.length - successCount} notice/error`,
          { icon: '⚠️' }
        );
      } else {
        toast.error('Dispatch returned notices or errors for selected boards.');
      }

      if (!isAuto) {
        setMultiPushModal({
          isDryRun,
          results,
          site: selectedSite,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      toast.error('Multi-board push error: ' + e.message);
    } finally {
      setPushing(false);
      setTesting(false);
    }
  };

  /* ------------------------------------------------------------
     15-Minute Regulatory Slot Boundary Countdown Engine
     Aligned strictly with CPCB :00, :15, :30, :45 boundaries.
     Actively triggers in-browser transmission when slot boundary
     reaches 00:00 (for real-time dashboard execution) alongside
     the 24/7 autonomous cloud cron.
     ------------------------------------------------------------ */
  const getSecondsUntilNextBoundary = () => {
    const istEpoch = Date.now() + 5.5 * 3600000;
    const mins = Math.floor(istEpoch / 60000) % 60;
    const secs = Math.floor(istEpoch / 1000) % 60;
    const nextSlotMin = (Math.floor(mins / 15) + 1) * 15;
    const diffMins = nextSlotMin - mins - 1;
    const diffSecs = 60 - secs;
    return Math.max(0, diffMins * 60 + diffSecs);
  };

  useEffect(() => {
    if (!autoPushEnabled) return;
    setSecondsUntilNextPush(getSecondsUntilNextBoundary());

    const intervalId = setInterval(() => {
      const remaining = getSecondsUntilNextBoundary();
      setSecondsUntilNextPush(remaining);

      // Current 15-minute slot boundary identifier
      const istEpoch = Date.now() + 5.5 * 3600000;
      const currentSlotId = Math.floor(istEpoch / (15 * 60 * 1000));

      // Slot rollover occurs when remaining is at or near 0, or right after reset (remaining >= 897)
      const isAtSlotBoundary = remaining <= 1 || remaining >= 897;

      if (isAtSlotBoundary && lastAutoPushedSlotRef.current !== currentSlotId) {
        lastAutoPushedSlotRef.current = currentSlotId;

        // Actively transmit if not currently busy
        if (!isPushingRef.current) {
          const currentMultiMode = isMultiBoardModeRef.current;
          const currentDraft = draftRef.current;
          const currentSite = selectedSiteRef.current;
          const currentMulti = multiSelectedBoardCodesRef.current;

          const hasValidCreds = Boolean(
            currentSite &&
            currentDraft.stationId?.trim() &&
            currentDraft.deviceId?.trim() &&
            currentDraft.tokenId?.trim() &&
            currentDraft.publicKeyPem?.trim()
          );

          if (currentMultiMode && currentMulti && currentMulti.length > 0) {
            toast('⏰ 15-Minute boundary reached: Auto-transmitting to selected boards...', { icon: '📡' });
            doMultiPush(false, true);
          } else if (hasValidCreds) {
            toast('⏰ 15-Minute boundary reached: Auto-transmitting to CPCB...', { icon: '📡' });
            triggerAutoPush(true);
          }
        }

        // Pull latest synchronization state from cloud DB
        setTimeout(refreshCloudStatus, 6000);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [autoPushEnabled, refreshCloudStatus]);

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

      const siteKeyId = selectedSite.siteCode || selectedSite.id;

      const payload = {
        siteId: siteKeyId,
        board: (selectedBoard && selectedBoard.code) || 'CPCB',
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
        toast.success(`⚡ Transmitted to CPCB (${paramDetails.length} params, ${result.durationMs || 0}ms)`);
      } else {
        toast.error(`CPCB Response: ${(result && (result.cpcbMsg || result.error)) || 'Check status'}`);
      }
      refreshCloudStatus();
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
      toast.error('Transmission error: ' + err.message);
    } finally {
      setAutoPushInProgress(false);
      setSecondsUntilNextPush(getSecondsUntilNextBoundary());
    }
  };

  const toggleAutoPush = async (enableState) => {
    const next = enableState !== undefined ? enableState : !autoPushEnabled;
    setAutoPushEnabled(next);
    setDraft((d) => ({ ...d, autoPush: next }));

    if (selectedSite && selectedBoard) {
      const siteKeyId = selectedSite.siteCode || selectedSite.id;
      const key = siteKeyId + '|' + selectedBoard.code;
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

      try {
        if (api.toggleAutoPushSite) {
          await api.toggleAutoPushSite(siteKeyId, next, selectedBoard.code);
        }
        if (api.saveBoardConfig) {
          await api.saveBoardConfig(siteKeyId, {
            ...draft,
            autoPush: next,
            boardCode: selectedBoard.code,
            action: next ? 'start' : 'stop',
            paramTokens: draft.paramTokens || {},
          });
        } else if (api.saveCpcbConfig) {
          await api.saveCpcbConfig(siteKeyId, {
            ...draft,
            autoPush: next,
            action: next ? 'start' : 'stop',
            paramTokens: draft.paramTokens || {},
          });
        }
        if (next && api.triggerAutoPushNow) {
          await api.triggerAutoPushNow(siteKeyId, selectedBoard.code);
        }
      } catch (err) {
        console.warn('toggleAutoPush error:', err.message);
      }
      refreshCloudStatus();
    }

    if (next) {
      toast.success('🛡️ 24/7 Cloud Automation enabled! Telemetry transmitting every 15 minutes.');
    } else {
      toast('🛑 24/7 Cloud Transmission STOPPED for this site.');
    }
  };

  const formatCountdown = (totalSecs) => {
    const m = Math.floor(Math.max(0, totalSecs) / 60);
    const s = Math.floor(Math.max(0, totalSecs) % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /* ------------------------------------------------------------
     Multi-Site Regulatory Status & Bulk Transmission Handlers
     ------------------------------------------------------------ */
  const fetchMultiSiteConfigs = async () => {
    setLoadingMultiSite(true);
    try {
      const res = await api.getAllBoardConfigs();
      const list = (res && (res.configs || res.sites)) || [];
      const normalized = list.map((item) => ({
        id: item.id,
        siteCode: item.site_code || item.siteCode || item.siteId,
        boardCode: item.board_code || item.boardCode || item.board || 'CPCB',
        boardName: item.board_name || item.boardName,
        stationId: item.station_id || item.stationId || '',
        deviceId: item.device_id || item.deviceId || '',
        autoPush: item.auto_push !== undefined ? Boolean(item.auto_push) : (item.autoPush !== undefined ? Boolean(item.autoPush) : true),
        lastPushedAt: item.last_pushed_at || item.lastPushedAt,
        lastPushStatus: item.last_push_status || item.lastPushStatus,
        lastPushMsg: item.last_push_msg || item.lastPushMsg,
        lastDurationMs: item.last_duration_ms || item.lastDurationMs,
      }));
      setMultiSiteConfigs(normalized);
    } catch (err) {
      toast.error('Failed to load multi-site configs: ' + err.message);
    } finally {
      setLoadingMultiSite(false);
    }
  };

  const triggerAllSitesCron = async () => {
    setTriggeringAll(true);
    try {
      toast.loading('⚡ Triggering 24/7 cloud cron across all registered sites...', { id: 'cron-all' });
      const res = await api.triggerAutoPushNow(null, null);
      const count = (res && (res.processedCount || res.count || (res.results && res.results.length))) || 'all';
      toast.success(`⚡ Cron executed across ${count} sites in parallel!`, { id: 'cron-all' });
      refreshCloudStatus();
      if (showMultiSiteModal) fetchMultiSiteConfigs();
    } catch (e) {
      toast.error('Cron trigger: ' + e.message, { id: 'cron-all' });
    } finally {
      setTriggeringAll(false);
    }
  };

  const triggerSingleSiteCron = async (siteCode, boardCode) => {
    try {
      toast.loading(`⚡ Triggering cron for ${siteCode} (${boardCode})...`, { id: 'cron-single-' + siteCode });
      await api.triggerAutoPushNow(siteCode, boardCode);
      toast.success(`⚡ Cron executed for ${siteCode}!`, { id: 'cron-single-' + siteCode });
      fetchMultiSiteConfigs();
      if (selectedSite && (selectedSite.siteCode === siteCode || selectedSite.id === siteCode)) {
        refreshCloudStatus();
      }
    } catch (e) {
      toast.error(`Cron error for ${siteCode}: ${e.message}`, { id: 'cron-single-' + siteCode });
    }
  };

  const toggleSingleSiteTransmission = async (siteCode, boardCode, enableState) => {
    try {
      const actionName = enableState ? 'Resuming' : 'Stopping';
      toast.loading(`${actionName} transmission for ${siteCode}...`, { id: 'toggle-' + siteCode });
      if (api.toggleAutoPushSite) {
        await api.toggleAutoPushSite(siteCode, enableState, boardCode);
      }
      toast.success(
        enableState
          ? `▶ 24/7 transmission resumed for ${siteCode} [${boardCode}]!`
          : `🛑 24/7 transmission STOPPED for ${siteCode} [${boardCode}]. No data will be sent to CPCB.`,
        { id: 'toggle-' + siteCode }
      );
      fetchMultiSiteConfigs();
      if (selectedSite && (selectedSite.siteCode === siteCode || selectedSite.id === siteCode)) {
        setAutoPushEnabled(enableState);
        setDraft((d) => ({ ...d, autoPush: enableState }));
        refreshCloudStatus();
      }
    } catch (e) {
      toast.error(`Error toggling transmission for ${siteCode}: ${e.message}`, { id: 'toggle-' + siteCode });
    }
  };

  const renderMultiSiteModal = () => {
    if (!showMultiSiteModal) return null;
    const activeCount = multiSiteConfigs.filter((c) => c.autoPush !== false).length;

    return (
      <Modal
        open={true}
        title="🌐 Multi-Site 24/7 Regulatory Transmission Overview"
        onClose={() => setShowMultiSiteModal(false)}
        width={940}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={triggerAllSitesCron}
              disabled={triggeringAll}
              style={{ fontWeight: 600 }}
            >
              {triggeringAll ? 'Executing Batches...' : '⚡ Run Cron for All Active Sites Now'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={fetchMultiSiteConfigs}
                disabled={loadingMultiSite}
              >
                {loadingMultiSite ? 'Refreshing...' : '🔄 Refresh Status'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowMultiSiteModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        }
      >
        <div style={{ padding: '4px 0' }}>
          {/* Header Summary Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}>
            <div style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total Configured Sites
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>
                {multiSiteConfigs.length}
              </div>
            </div>

            <div style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                24/7 Auto-Push Active
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--st-green)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--st-green)' }}></span>
                {activeCount}
              </div>
            </div>

            <div style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Next Regulatory Slot
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)', marginTop: 4, fontFamily: 'monospace' }}>
                {formatCountdown(secondsUntilNextPush)}
              </div>
            </div>

            <div style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Engine Architecture
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--st-green)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                ✓ GitHub Actions + Edge Cron
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                Parallel Batches (8 Sites/Batch)
              </div>
            </div>
          </div>

          {/* Site Configurations Table */}
          {loadingMultiSite ? (
            <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              Loading multi-site regulatory configurations from cloud database...
            </div>
          ) : multiSiteConfigs.length === 0 ? (
            <div style={{
              padding: '32px 16px',
              textAlign: 'center',
              background: 'var(--surface-2)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                No board configurations found in 24/7 database
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
                Open any site from the grid, enter Station ID, Device ID, Token ID, and Public.pem, then click &quot;⚡ Hit Live Data&quot; or enable the 24/7 Cloud Engine to register it.
              </div>
            </div>
          ) : (
            <div style={{
              overflowX: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface)',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)' }}>Site Code</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)' }}>Board</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)' }}>Station / Device</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)' }}>24/7 Cron</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)' }}>Last Transmitted (IST)</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)' }}>Last Status</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-2)', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {multiSiteConfigs.map((cfg, idx) => {
                    const isSuccess = cfg.lastPushStatus && (
                      cfg.lastPushStatus.includes('200') ||
                      cfg.lastPushStatus.toLowerCase().includes('ok') ||
                      cfg.lastPushStatus.toLowerCase().includes('success')
                    );
                    const isConfigured = Boolean(cfg.stationId && cfg.deviceId);

                    return (
                      <tr
                        key={cfg.id || (cfg.siteCode + '-' + cfg.boardCode + '-' + idx)}
                        style={{
                          borderBottom: idx < multiSiteConfigs.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{cfg.siteCode}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span className="badge" style={{ fontSize: 11, fontWeight: 600 }}>{cfg.boardCode}</span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--ink-2)' }}>
                          <div>{cfg.stationId || '-'}</div>
                          <div style={{ color: 'var(--ink-3)' }}>{cfg.deviceId || '-'}</div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {cfg.autoPush !== false && isConfigured ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              color: 'var(--st-green)',
                              fontWeight: 600,
                              fontSize: 11,
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--st-green)' }}></span>
                              Active (15m)
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              color: 'var(--st-red, #ef4444)',
                              fontWeight: 600,
                              fontSize: 11,
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--st-red, #ef4444)' }}></span>
                              Stopped
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 11 }}>
                          {formatIstDate(cfg.lastPushedAt)}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {cfg.lastPushStatus ? (
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: isSuccess ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                color: isSuccess ? 'var(--st-green)' : 'var(--st-red)',
                                border: `1px solid ${isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                              }}
                              title={cfg.lastPushMsg || ''}
                            >
                              {cfg.lastPushStatus}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--ink-4)', fontSize: 11 }}>Pending</span>
                          )}
                          {cfg.lastDurationMs ? (
                            <span style={{ fontSize: 10, color: 'var(--ink-3)', marginLeft: 4 }}>
                              {cfg.lastDurationMs}ms
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {cfg.autoPush !== false && isConfigured ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => toggleSingleSiteTransmission(cfg.siteCode, cfg.boardCode, false)}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: 11,
                                  background: 'rgba(239, 68, 68, 0.12)',
                                  color: 'var(--st-red, #ef4444)',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  fontWeight: 600,
                                }}
                                title="Stop data transmission to CPCB for this site"
                              >
                                🛑 Stop
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => toggleSingleSiteTransmission(cfg.siteCode, cfg.boardCode, true)}
                                disabled={!isConfigured}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: 11,
                                  background: 'rgba(16, 185, 129, 0.12)',
                                  color: 'var(--st-green, #10b981)',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  fontWeight: 600,
                                }}
                                title="Resume 24/7 data transmission to CPCB for this site"
                              >
                                ▶ Resume
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => triggerSingleSiteCron(cfg.siteCode, cfg.boardCode)}
                              disabled={!isConfigured || cfg.autoPush === false}
                              style={{ padding: '3px 8px', fontSize: 11 }}
                              title={cfg.autoPush === false ? 'Cannot trigger transmission while site is stopped' : 'Trigger immediate transmission for this site'}
                            >
                              ⚡ Trigger
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    );
  };

  const renderMultiPushModal = () => {
    if (!multiPushModal) return null;
    const { isDryRun, results, site } = multiPushModal;
    const okCount = results.filter((r) => r.ok).length;
    const totalCount = results.length;
    const allPassed = okCount === totalCount && totalCount > 0;

    return (
      <Modal
        open={true}
        title={isDryRun ? 'Multi-Board Dry Run Validation Summary' : 'Multi-Board Regulatory Dispatch Summary'}
        onClose={() => setMultiPushModal(null)}
        width={720}
        footer={
          <button className="btn btn-primary" onClick={() => setMultiPushModal(null)}>
            Done
          </button>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: allPassed ? 'var(--st-green)' : okCount > 0 ? 'var(--st-orange)' : 'var(--st-red)',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              {allPassed ? '✓' : okCount > 0 ? '!' : '✕'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              {isDryRun
                ? `Validation Completed: ${okCount} of ${totalCount} Boards Ready`
                : `Transmitted: ${okCount} of ${totalCount} Pollution Boards Acknowledged`}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
              <b>{site.name}</b> ({site.siteCode || site.id}) · {new Date().toLocaleTimeString()}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {results.map((r, idx) => (
              <div
                key={r.board.code + '-' + idx}
                style={{
                  background: 'var(--surface-2)',
                  border: `1px solid ${r.ok ? 'rgba(16, 185, 129, 0.3)' : r.skipped ? 'var(--border)' : 'rgba(239, 68, 68, 0.3)'}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        background: 'var(--primary)',
                        color: '#fff',
                      }}
                    >
                      {r.board.code}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                      {r.board.name}
                    </span>
                  </div>
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 700,
                      background: r.ok ? 'rgba(16, 185, 129, 0.15)' : r.skipped ? 'rgba(156, 163, 175, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: r.ok ? 'var(--st-green)' : r.skipped ? 'var(--ink-3)' : 'var(--st-red)',
                      border: `1px solid ${r.ok ? 'rgba(16, 185, 129, 0.3)' : r.skipped ? 'var(--border)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {r.ok ? `✓ SUCCESS (${r.status})` : r.skipped ? '⚠️ SKIPPED / INCOMPLETE' : `ERR (${r.status})`}
                  </span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 4 }}>
                  <div><b>Response Message:</b> {r.msg || r.error || (r.ok ? 'Packets accepted' : 'No message')}</div>
                  {r.durationMs > 0 && <div><b>Latency:</b> {r.durationMs}ms</div>}
                </div>

                {r.result && (
                  <details style={{ marginTop: 8, fontSize: 11 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}>
                      View Raw Details
                    </summary>
                    <pre
                      style={{
                        background: 'var(--surface)',
                        padding: 8,
                        borderRadius: 6,
                        maxHeight: 120,
                        overflowY: 'auto',
                        fontSize: 11,
                        marginTop: 4,
                      }}
                    >
                      {typeof r.result === 'object' ? JSON.stringify(r.result, null, 2) : String(r.result)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      </Modal>
    );
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
      : Boolean(draft.tokenId.trim() && (draft.siteId.trim() || draft.stationId.trim()) && selectedCount > 0);

    const multiConfiguredCount = multiSelectedBoardCodes.filter(checkBoardConfigured).length;
    const isMultiReadyToPush = multiSelectedBoardCodes.length > 0 && multiConfiguredCount > 0 && selectedCount > 0;

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
        {/* Target Board selector with Single / Multi-Board Mode Switcher */}
        <Panel
          title="Select Destination Regulatory Authority"
          hint={
            isMultiBoardMode
              ? `Multi-Board Mode: Hit data simultaneously to ${multiSelectedBoardCodes.length} selected pollution boards`
              : 'Single Authority Mode: Select CPCB or State Pollution Control Board'
          }
          right={
            <div
              style={{
                display: 'inline-flex',
                background: 'var(--surface-2)',
                padding: '3px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                gap: 4,
              }}
            >
              <button
                type="button"
                className={`btn btn-sm ${!isMultiBoardMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 12, padding: '4px 12px', fontWeight: 600 }}
                onClick={() => setIsMultiBoardMode(false)}
              >
                🎯 Single Board
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isMultiBoardMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 12, padding: '4px 12px', fontWeight: 600 }}
                onClick={() => {
                  setIsMultiBoardMode(true);
                  if (selectedBoard && !multiSelectedBoardCodes.includes(selectedBoard.code)) {
                    setMultiSelectedBoardCodes((prev) => [...prev, selectedBoard.code]);
                  }
                }}
              >
                🌐 Multi-Board (Simultaneous)
              </button>
            </div>
          }
        >
          {!isMultiBoardMode ? (
            /* ---- Single Board Mode Form ---- */
            <div className="form-grid">
              <div className="fg">
                <label>Regulatory Board <span className="req">*</span></label>
                <select
                  value={selectedBoard ? selectedBoard.code : 'CPCB'}
                  onChange={(e) => {
                    const b = BOARDS.find((x) => x.code === e.target.value);
                    switchActiveBoard(b || BOARDS[0]);
                  }}
                >
                  {BOARDS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
                <div className="hint">
                  {checkBoardConfigured(selectedBoard.code) ? (
                    <span style={{ color: 'var(--st-green)', fontWeight: 600 }}>✓ Credentials configured in database</span>
                  ) : (
                    <span style={{ color: 'var(--st-orange)' }}>⚠️ Requires Station/Device credentials below</span>
                  )}
                </div>
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
                  <span>{selectedBoard.isCpcb ? 'Official CPCB v1.0 data endpoint' : `${selectedBoard.code} endpoint`}</span>
                  {draft.apiUrl !== (selectedBoard.isCpcb ? 'https://cems.cpcb.gov.in/v1.0/industry/data' : selectedBoard.url) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 6px', fontSize: 11 }}
                      onClick={() => setDraft({ ...draft, apiUrl: selectedBoard.isCpcb ? 'https://cems.cpcb.gov.in/v1.0/industry/data' : selectedBoard.url })}
                    >
                      Reset to Default
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ---- Multi-Board Mode Selection Grid ---- */
            <div>
              {/* Quick toolbar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 14,
                  flexWrap: 'wrap',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: 12,
                      background: 'var(--primary)',
                      color: '#fff',
                    }}
                  >
                    {multiSelectedBoardCodes.length} of {BOARDS.length} Boards Selected
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    Data will be simultaneously transmitted to all checked boards
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={selectAllBoards}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={selectCpcbAndSpcb}
                  >
                    CPCB + State SPCB
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => setMultiSelectedBoardCodes(['CPCB'])}
                  >
                    Reset (CPCB Only)
                  </button>
                </div>
              </div>

              {/* Board Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 12,
                }}
              >
                {BOARDS.map((b) => {
                  const isChecked = multiSelectedBoardCodes.includes(b.code);
                  const isConfigured = checkBoardConfigured(b.code);
                  const isCurrentlyActive = selectedBoard && selectedBoard.code === b.code;

                  return (
                    <div
                      key={b.code}
                      style={{
                        background: isChecked ? 'var(--surface)' : 'var(--surface-2)',
                        border: isCurrentlyActive
                          ? '2px solid var(--primary)'
                          : isChecked
                          ? '1px solid var(--primary-border, rgba(59, 130, 246, 0.4))'
                          : '1px solid var(--border)',
                        borderRadius: 8,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 10,
                        transition: 'all 0.15s ease',
                        boxShadow: isCurrentlyActive ? '0 0 10px rgba(59, 130, 246, 0.2)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleMultiBoard(b.code)}
                          style={{ marginTop: 3, cursor: 'pointer', width: 16, height: 16 }}
                          title={`Toggle ${b.code} for simultaneous hit`}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                              {b.code}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: isConfigured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                color: isConfigured ? 'var(--st-green)' : 'var(--st-orange)',
                                border: `1px solid ${isConfigured ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                              }}
                            >
                              {isConfigured ? '✓ Configured' : '⚠️ Need Keys'}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.3 }}>
                            {b.name}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderTop: '1px solid var(--border)',
                          paddingTop: 8,
                          fontSize: 11,
                        }}
                      >
                        <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                          {b.isCpcb ? 'National OCEMS' : 'State SPCB'}
                        </span>
                        <button
                          type="button"
                          className={`btn btn-sm ${isCurrentlyActive ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => switchActiveBoard(b)}
                        >
                          {isCurrentlyActive ? 'Editing Keys ✏️' : 'Configure ⚙️'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        {selectedBoard ? (
          <>
            {/* Multi-Board Active Credentials Navigation Bar */}
            {isMultiBoardMode && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 14,
                  padding: '8px 12px',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  overflowX: 'auto',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                  Configure Credentials for:
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {BOARDS.map((b) => {
                    const isSelectedInMulti = multiSelectedBoardCodes.includes(b.code);
                    const isActive = selectedBoard.code === b.code;
                    const isConfigured = checkBoardConfigured(b.code);
                    return (
                      <button
                        key={b.code}
                        type="button"
                        className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-ghost'}`}
                        style={{
                          fontSize: 11,
                          padding: '3px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontWeight: isActive ? 700 : 500,
                          opacity: isSelectedInMulti ? 1 : 0.65,
                        }}
                        onClick={() => switchActiveBoard(b)}
                      >
                        <span>{b.code}</span>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: isConfigured ? 'var(--st-green)' : 'var(--st-orange)',
                          }}
                        ></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                  {!isCpcb && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={copyCredsFromCpcb}
                      title="Copy Station ID, Device ID, Token ID, and Public Key from CPCB"
                      style={{ fontSize: 11 }}
                    >
                      📋 Copy from CPCB
                    </button>
                  )}
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
                        const customTokenCfg = (draft.paramTokens && draft.paramTokens[k]) || {};
                        const hasCustomToken = Boolean(customTokenCfg && customTokenCfg.tokenId && customTokenCfg.tokenId.trim());
                        const isEditorOpen = Boolean(openParamTokenEditors && openParamTokenEditors[k]);

                        return (
                          <div
                            key={p.pid || (k + '-' + idx)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              padding: '10px 14px',
                              borderRadius: 8,
                              border: hasCustomToken
                                ? '1px solid var(--st-green)'
                                : on
                                ? '1px solid var(--primary)'
                                : '1px solid var(--border)',
                              background: hasCustomToken
                                ? 'rgba(16, 185, 129, 0.04)'
                                : on
                                ? 'var(--primary-soft, rgba(16, 185, 129, 0.05))'
                                : 'var(--surface-2)',
                              transition: 'all 120ms ease',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: 12,
                                width: '100%',
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
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 600, fontSize: 13, color: on ? 'var(--ink)' : 'var(--ink-2)' }}>
                                      {displayName}
                                    </span>
                                    {hasCustomToken && (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 700,
                                          padding: '1px 6px',
                                          borderRadius: 10,
                                          background: 'rgba(16, 185, 129, 0.15)',
                                          color: 'var(--st-green)',
                                          border: '1px solid rgba(16, 185, 129, 0.3)',
                                        }}
                                      >
                                        🔑 Dedicated Token Active
                                      </span>
                                    )}
                                  </div>
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

                              {/* Right: CPCB Measurement Unit Manual Controls + Dedicated Token Toggle */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                                  CPCB Unit:
                                </span>

                                {/* Quick Unit Presets */}
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {['mg/m³', 'mg/m3', 'mg/Nm³', 'mg/Nm3', 'ug/m³', 'ppm'].map((uOption) => (
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
                                  value={['mg/m³', 'mg/m3', 'mg/Nm³', 'mg/Nm3', 'ug/m³', 'ug/m3', 'ppm', 'mg/l', 'pH', '%', 'm3/hr', 'degC'].includes(activeUnit) ? activeUnit : 'custom'}
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
                                  <option value="mg/m³">mg/m³ (CPCB Registered)</option>
                                  <option value="mg/m3">mg/m3</option>
                                  <option value="mg/Nm³">mg/Nm³</option>
                                  <option value="mg/Nm3">mg/Nm3</option>
                                  <option value="ug/m³">ug/m³</option>
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

                                {/* Dedicated Parameter Token Toggle Button */}
                                <button
                                  type="button"
                                  onClick={() => toggleParamTokenEditor(k)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '3px 9px',
                                    height: 28,
                                    fontSize: 11,
                                    fontWeight: hasCustomToken ? 700 : 500,
                                    borderRadius: 4,
                                    border: hasCustomToken
                                      ? '1px solid var(--st-green)'
                                      : isEditorOpen
                                      ? '1px solid var(--primary)'
                                      : '1px solid var(--border)',
                                    background: hasCustomToken
                                      ? 'rgba(16, 185, 129, 0.12)'
                                      : isEditorOpen
                                      ? 'var(--primary-soft, rgba(16, 185, 129, 0.08))'
                                      : 'var(--surface)',
                                    color: hasCustomToken
                                      ? 'var(--st-green)'
                                      : 'var(--ink-2)',
                                    cursor: 'pointer',
                                    transition: 'all 120ms ease',
                                  }}
                                  title={hasCustomToken ? `Separate token configured for ${k}. Click to edit.` : `Configure separate token details for ${k}`}
                                >
                                  <span>🔑</span>
                                  <span>{hasCustomToken ? 'Token Override ✓' : 'Separate Token'}</span>
                                  <span style={{ fontSize: 9, opacity: 0.7 }}>{isEditorOpen ? '▲' : '▼'}</span>
                                </button>
                              </div>
                            </div>

                            {/* Expandable Per-Parameter Token Configuration Card */}
                            {isEditorOpen && (
                              <div
                                style={{
                                  width: '100%',
                                  marginTop: 6,
                                  padding: '12px 14px',
                                  borderRadius: 6,
                                  background: 'var(--surface)',
                                  border: '1px solid var(--border)',
                                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 14 }}>🔑</span>
                                    <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>
                                      Separate Token Credentials for <span style={{ color: 'var(--primary)' }}>{displayName}</span>
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {hasCustomToken && (
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => removeParamTokenOverride(k)}
                                        style={{ fontSize: 11, color: '#ef4444', padding: '2px 8px', height: 26 }}
                                        title="Remove override and revert to default board credentials"
                                      >
                                        🗑️ Revert to Board Token
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => toggleParamTokenEditor(k)}
                                      style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </div>

                                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10, lineHeight: 1.4 }}>
                                  When pollution boards issue distinct tokens per parameter or stack (e.g. STACK-1 vs STACK-2), enter the dedicated token below. Leave Device ID / Station ID blank to inherit the main board credentials.
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                                  <div>
                                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 3 }}>
                                      Parameter-Specific Token ID <span style={{ color: '#ef4444' }}>*</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={customTokenCfg.tokenId || ''}
                                      onChange={(e) => updateParamTokenField(k, 'tokenId', e.target.value)}
                                      placeholder={`e.g. Token ID for ${k}`}
                                      style={{
                                        width: '100%',
                                        height: 30,
                                        fontSize: 11,
                                        fontFamily: 'var(--font-mono)',
                                        padding: '4px 8px',
                                        borderRadius: 4,
                                        border: hasCustomToken ? '1px solid var(--st-green)' : '1px solid var(--border)',
                                        background: 'var(--surface-2)',
                                        color: 'var(--ink)',
                                      }}
                                    />
                                  </div>

                                  <div>
                                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 3 }}>
                                      Device ID <span style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 400 }}>(Optional - default: {draft.deviceId || 'main'})</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={customTokenCfg.deviceId || ''}
                                      onChange={(e) => updateParamTokenField(k, 'deviceId', e.target.value)}
                                      placeholder={draft.deviceId || 'Inherits default Device ID'}
                                      style={{
                                        width: '100%',
                                        height: 30,
                                        fontSize: 11,
                                        fontFamily: 'var(--font-mono)',
                                        padding: '4px 8px',
                                        borderRadius: 4,
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface-2)',
                                        color: 'var(--ink)',
                                      }}
                                    />
                                  </div>

                                  <div>
                                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 3 }}>
                                      Station ID <span style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 400 }}>(Optional - default: {draft.stationId || 'main'})</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={customTokenCfg.stationId || ''}
                                      onChange={(e) => updateParamTokenField(k, 'stationId', e.target.value)}
                                      placeholder={draft.stationId || 'Inherits default Station ID'}
                                      style={{
                                        width: '100%',
                                        height: 30,
                                        fontSize: 11,
                                        fontFamily: 'var(--font-mono)',
                                        padding: '4px 8px',
                                        borderRadius: 4,
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface-2)',
                                        color: 'var(--ink)',
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* ================= STATE BOARD ENHANCED FORM ================= */
                <div className="form-grid">
                  <div className="fg">
                    <label>Station ID / Site ID <span className="req">*</span></label>
                    <input
                      value={draft.stationId || draft.siteId}
                      onChange={(e) => setDraft({ ...draft, stationId: e.target.value, siteId: e.target.value })}
                      placeholder={'e.g. Station or Site ID on ' + selectedBoard.code}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="hint">
                      Registered Station or Site identifier for {selectedBoard.code}
                    </div>
                  </div>

                  <div className="fg">
                    <label>Device ID</label>
                    <input
                      value={draft.deviceId}
                      onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })}
                      placeholder={'e.g. Device ID on ' + selectedBoard.code}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="hint">
                      IoT / analyzer device ID (matches CPCB if sharing ODAMS setup)
                    </div>
                  </div>

                  <div className="fg">
                    <label>Token ID / API Key <span className="req">*</span></label>
                    <input
                      value={draft.tokenId}
                      onChange={(e) => setDraft({ ...draft, tokenId: e.target.value })}
                      placeholder={'API Key or Token for ' + selectedBoard.code}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="hint">
                      Authentication key issued by {selectedBoard.code}
                    </div>
                  </div>

                  <div className="fg">
                    <label>Target API Endpoint</label>
                    <input
                      value={draft.apiUrl}
                      onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
                      placeholder={selectedBoard.url}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    />
                    <div className="hint">
                      Official portal transmission URL for {selectedBoard.code}
                    </div>
                  </div>

                  {/* Public Key Attachment for ODAMS-compliant State Boards */}
                  <div className="fg fg-wide">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: hasPemAttached ? 'var(--st-green)' : 'var(--primary)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 18,
                            fontWeight: 700,
                          }}
                        >
                          {hasPemAttached ? '✓' : '🔑'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                            {hasPemAttached
                              ? draft.publicKeyFileName || 'Public.pem Attached'
                              : `Public.pem RSA Key (Optional for ${selectedBoard.code})`}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                            {hasPemAttached
                              ? `Ready for encryption · ${draft.publicKeyPem.length} characters`
                              : 'Upload or paste RSA Public key if board mandates encryption'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => fileInputRef.current && fileInputRef.current.click()}
                        >
                          📂 {hasPemAttached ? 'Replace File' : 'Upload Key'}
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

                    {showKeyEditor && (
                      <div style={{ marginTop: 10 }}>
                        <textarea
                          rows={5}
                          value={draft.publicKeyPem}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              publicKeyPem: e.target.value,
                              publicKeyFileName: e.target.value ? (draft.publicKeyFileName || 'Public.pem') : '',
                            })
                          }
                          placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            background: 'var(--surface)',
                            color: 'var(--ink)',
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Optional Legacy Portal Credentials */}
                  <div className="fg">
                    <label>Portal User ID <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(Optional)</span></label>
                    <input
                      value={draft.siteUserId}
                      onChange={(e) => setDraft({ ...draft, siteUserId: e.target.value })}
                      placeholder="Username for web login"
                    />
                  </div>

                  <div className="fg">
                    <label>Portal Password <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(Optional)</span></label>
                    <input
                      type="password"
                      value={draft.password}
                      onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                      placeholder="Password for web login"
                    />
                  </div>

                  {/* Parameters Grid */}
                  <div className="fg fg-wide">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ margin: 0 }}>Parameters ({selectedCount} of {allParams.length} selected)</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => setDraft({ ...draft, parameters: allParams.slice() })}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => setDraft({ ...draft, parameters: [] })}
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
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

            {/* ---- 24/7 Autonomous Cloud Regulatory Transmission Panel ---- */}
            {isCpcb && (
              <Panel
                title="🛡️ 24/7 Autonomous Regulatory Transmission (Zero Laptop Dependency)"
                hint="Compliant with CPCB OCEMS mandate: transmits sensor packets every 15 minutes continuously from cloud servers"
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        background: autoPushEnabled && isReadyToPush
                          ? 'rgba(16, 185, 129, 0.15)'
                          : !autoPushEnabled
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(156, 163, 175, 0.15)',
                        color: autoPushEnabled && isReadyToPush
                          ? 'var(--st-green)'
                          : !autoPushEnabled
                          ? '#ef4444'
                          : 'var(--ink-3)',
                        border: autoPushEnabled && isReadyToPush
                          ? '1px solid rgba(16, 185, 129, 0.3)'
                          : !autoPushEnabled
                          ? '1px solid rgba(239, 68, 68, 0.35)'
                          : '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: autoPushEnabled && isReadyToPush
                            ? 'var(--st-green)'
                            : !autoPushEnabled
                            ? '#ef4444'
                            : 'var(--ink-4)',
                          boxShadow: autoPushEnabled && isReadyToPush
                            ? '0 0 8px var(--st-green)'
                            : !autoPushEnabled
                            ? '0 0 8px rgba(239, 68, 68, 0.6)'
                            : 'none',
                        }}
                      />
                      {autoPushEnabled && isReadyToPush
                        ? '24/7 Cloud Engine Active'
                        : !autoPushEnabled
                        ? '🛑 Transmission Stopped (No Data Sent to CPCB)'
                        : 'Cloud Automation Paused'}
                    </span>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const siteKeyId = selectedSite.siteCode || selectedSite.id;
                        try {
                          toast.loading(`Triggering cron cycle for ${siteKeyId}...`, { id: 'cron-trig' });
                          if (api.triggerAutoPushNow) {
                            await api.triggerAutoPushNow(siteKeyId, selectedBoard?.code || 'CPCB');
                          }
                          await refreshCloudStatus();
                          toast.success('⚡ Cron transmission executed!', { id: 'cron-trig' });
                        } catch (e) {
                          toast.error('Cron trigger: ' + e.message, { id: 'cron-trig' });
                        }
                      }}
                      style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600 }}
                      title="Run scheduled transmission cycle immediately for this site"
                    >
                      ⚡ Run Cron (This Site)
                    </button>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={triggerAllSitesCron}
                      disabled={triggeringAll}
                      style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, color: 'var(--primary)', borderColor: 'var(--primary)' }}
                      title="Run scheduled transmission cycle across ALL configured sites simultaneously"
                    >
                      {triggeringAll ? 'Running All...' : '⚡ Run Cron (All Sites)'}
                    </button>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setShowMultiSiteModal(true);
                        fetchMultiSiteConfigs();
                      }}
                      style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600 }}
                      title="Inspect 24/7 regulatory transmission status of all configured sites"
                    >
                      🌐 All Sites Status
                    </button>

                    <button
                      type="button"
                      className={`btn btn-sm ${autoPushEnabled ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => toggleAutoPush(!autoPushEnabled)}
                      style={{
                        padding: '6px 16px',
                        fontSize: 12,
                        fontWeight: 700,
                        boxShadow: autoPushEnabled ? '0 2px 8px rgba(239, 68, 68, 0.25)' : '0 2px 8px rgba(16, 185, 129, 0.25)',
                      }}
                      title={autoPushEnabled ? 'Immediately stop automated data transmission of this site to CPCB' : 'Resume automated 24/7 transmission of this site to CPCB'}
                    >
                      {autoPushEnabled ? '🛑 Stop Transmission to CPCB' : '▶ Resume 24/7 Transmission to CPCB'}
                    </button>
                  </div>
                }
              >
                {/* Reassurance Banner or Stop Notice Banner */}
                {!autoPushEnabled ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontSize: 24, lineHeight: 1 }}>🛑</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
                        CPCB Regulatory Transmission is STOPPED for this site
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                        Scheduled cloud background workers (GitHub Actions, Render Cloud, and Edge) are strictly configured to <b>skip this site</b>. No telemetry packets will be sent to CPCB ODAMS until you resume transmission.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => toggleAutoPush(true)}
                      style={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                    >
                      ▶ Resume Now
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.05) 100%)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontSize: 24, lineHeight: 1 }}>💻⚡</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>
                        Your Laptop Does NOT Need to Stay On
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                        Telemetry hits are executed autonomously by <b>Cloud Background Workers (GitHub Actions &amp; Render Cloud)</b> directly into CPCB ODAMS every 15 minutes (:00, :15, :30, :45). You can safely close your browser, turn off your laptop, or disconnect anytime without interrupting compliance.
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        background: 'var(--surface)',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--st-green)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>✓ 100% Cloud Autonomous</span>
                    </div>
                  </div>
                )}

                {/* 4-Column Live Metric Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: 14,
                    padding: 14,
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    marginBottom: 14,
                    alignItems: 'center',
                  }}
                >
                  {/* 1. Next Regulatory Transmission Slot */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: '50%',
                        background: 'var(--surface)',
                        border: '2px solid var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--primary)',
                        flexShrink: 0,
                      }}
                    >
                      {autoPushEnabled && isReadyToPush ? formatCountdown(secondsUntilNextPush) : '--:--'}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                        Next Cloud Slot In
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                        {autoPushEnabled && isReadyToPush
                          ? `${Math.ceil(secondsUntilNextPush / 60)} min (${formatCountdown(secondsUntilNextPush)})`
                          : !autoPushEnabled
                          ? '🛑 Transmission Stopped'
                          : 'Paused / Missing Credentials'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>
                        CPCB {autoPushIntervalMins}-min slot (:00, :15, :30, :45)
                      </div>
                    </div>
                  </div>

                  {/* 2. Last Cloud Transmission Result (From PostgreSQL Database) */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 3 }}>
                      Last Cloud Transmission
                    </div>
                    {cloudPushInfo && cloudPushInfo.at ? (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                          <span
                            style={{
                              color: String(cloudPushInfo.status).includes('200') || String(cloudPushInfo.status) === '1' || String(cloudPushInfo.msg).toLowerCase().includes('success')
                                ? 'var(--st-green)'
                                : 'var(--st-red)',
                            }}
                          >
                            {String(cloudPushInfo.status).includes('200') || String(cloudPushInfo.status) === '1' || String(cloudPushInfo.msg).toLowerCase().includes('success') ? '✓' : '✗'}
                          </span>
                          <span style={{ color: 'var(--ink)' }}>
                            {new Date(cloudPushInfo.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} IST
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: String(cloudPushInfo.status).includes('200') || String(cloudPushInfo.status) === '1' || String(cloudPushInfo.msg).toLowerCase().includes('success')
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(239, 68, 68, 0.15)',
                              color: String(cloudPushInfo.status).includes('200') || String(cloudPushInfo.status) === '1' || String(cloudPushInfo.msg).toLowerCase().includes('success')
                                ? 'var(--st-green)'
                                : 'var(--st-red)',
                              fontWeight: 700,
                            }}
                          >
                            {cloudPushInfo.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={cloudPushInfo.msg}>
                          {cloudPushInfo.msg || 'Success'}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        Awaiting scheduled cycle...
                      </div>
                    )}
                  </div>

                  {/* 3. Cloud Worker Status */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 3 }}>
                      Cloud Infrastructure
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--st-green)', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <span>✓ GitHub Actions Cron (24/7)</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
                      Render PostgreSQL Sync Active
                    </div>
                  </div>

                  {/* 4. Controls */}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => triggerAutoPush(false)}
                      disabled={autoPushInProgress || pushing || !isReadyToPush}
                      title="Trigger an immediate live test transmission to verify CPCB connection"
                      style={{ height: 34, fontSize: 12 }}
                    >
                      {autoPushInProgress ? 'Pushing...' : '⚡ Hit Now (Instant Test)'}
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
              title={
                isMultiBoardMode
                  ? `🚀 Simultaneous Transmission to Multiple Authorities (${multiSelectedBoardCodes.length} Selected)`
                  : (isCpcb ? 'Transmit to CPCB Server' : 'Push to ' + selectedBoard.code)
              }
              hint={
                isMultiBoardMode
                  ? `Dispatches real-time telemetry packets simultaneously to: ${multiSelectedBoardCodes.join(', ')}`
                  : (isCpcb ? 'Target: ' + draft.apiUrl : selectedBoard.name)
              }
              right={
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => isMultiBoardMode ? doMultiPush(true) : doPush(true)}
                    disabled={testing || pushing || (isMultiBoardMode ? !isMultiReadyToPush : !isReadyToPush)}
                    title="Validate signature and payload without network push"
                  >
                    {testing
                      ? 'Validating...'
                      : isMultiBoardMode
                      ? `🧪 Validate All (${multiSelectedBoardCodes.length})`
                      : '🧪 Validate / Dry Run'}
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ minWidth: 150, fontWeight: 600 }}
                    onClick={() => isMultiBoardMode ? doMultiPush(false) : doPush(false)}
                    disabled={pushing || testing || (isMultiBoardMode ? !isMultiReadyToPush : !isReadyToPush)}
                  >
                    {pushing
                      ? 'Transmitting...'
                      : isMultiBoardMode
                      ? `🚀 Hit Data to All Boards (${multiSelectedBoardCodes.length})`
                      : (isCpcb ? '🚀 Hit Data to CPCB' : `Hit to ${selectedBoard.code}`)}
                  </button>
                </div>
              }
            >
              {isMultiBoardMode ? (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    Destination Authorities Queue:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {multiSelectedBoardCodes.map((code) => {
                      const b = BOARDS.find((x) => x.code === code) || { code, name: code };
                      const ready = checkBoardConfigured(code);
                      const bCreds = getCredsForBoard(code);
                      return (
                        <div
                          key={code}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            background: 'var(--surface-2)',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                background: 'var(--primary)',
                                color: '#fff',
                              }}
                            >
                              {b.code}
                            </span>
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{b.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                              {bCreds.apiUrl || b.url}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: ready ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                color: ready ? 'var(--st-green)' : 'var(--st-orange)',
                                border: `1px solid ${ready ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                              }}
                            >
                              {ready ? '✓ Ready' : '⚠️ Missing Keys'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--ink-2)', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <span>
                      <b>Telemetry Parameters:</b> {draft.parameters.join(', ') || 'All active parameters'}
                    </span>
                    <span style={{ fontWeight: 600, color: isMultiReadyToPush ? 'var(--st-green)' : 'var(--st-orange)' }}>
                      {isMultiReadyToPush
                        ? `✓ Ready to dispatch to ${multiConfiguredCount} configured authority(ies)`
                        : '⚠️ Please configure credentials for at least one selected authority'}
                    </span>
                  </div>
                </div>
              ) : (
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
              )}

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

        {renderMultiSiteModal()}
        {renderMultiPushModal()}
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={triggerAllSitesCron}
            disabled={triggeringAll}
            title="Trigger immediate 15-minute transmission cycle for all active sites"
            style={{ fontWeight: 600 }}
          >
            {triggeringAll ? 'Running...' : '⚡ Run Cron (All Sites)'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowMultiSiteModal(true);
              fetchMultiSiteConfigs();
            }}
            title="Inspect 24/7 regulatory transmission status across all sites"
            style={{ fontWeight: 600 }}
          >
            🌐 Multi-Site Status
          </button>
          <button className="btn btn-ghost btn-sm" onClick={lock}>
            🔒 Lock Gateway
          </button>
        </div>
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

      {renderMultiSiteModal()}
    </>
  );
}
