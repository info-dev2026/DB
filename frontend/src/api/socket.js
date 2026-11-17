/* ============================================================
   Socket.IO client — listens to real-time events from backend
   ============================================================ */
import { io } from 'socket.io-client';

const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1');

export const AZURE_SOCKET_URL = 'https://saaphzone-backend.azurewebsites.net';
export const RENDER_SOCKET_URL = 'https://saaphzone-backend.onrender.com';

export function getSocketUrl() {
  try {
    const custom = localStorage.getItem('sz_socket_url');
    if (custom && custom.trim()) {
      if (!isLocal && (custom.includes('localhost') || custom.includes('127.0.0.1'))) {
        localStorage.removeItem('sz_socket_url');
      } else {
        return custom.trim();
      }
    }
  } catch {}

  if (process.env.REACT_APP_SOCKET_URL) {
    return process.env.REACT_APP_SOCKET_URL;
  }

  return AZURE_SOCKET_URL;
}

export const SOCKET_URL = getSocketUrl();

let socket = null;
let fallbackSocket = null;
const listeners = {};

/* ---------- Connect to both Azure & Render backends so live updates from either API arrive ---------- */
export function connectSocket(session) {
  if (socket) return socket;

  const targetUrl = getSocketUrl();
  const secondaryUrl = targetUrl.includes('azurewebsites.net') ? RENDER_SOCKET_URL : AZURE_SOCKET_URL;

  const attachEvents = (sock, label) => {
    sock.on('connect', () => {
      console.log(`[socket:${label}] connected`);
      if (session) {
        sock.emit('join', {
          role: session.role,
          siteId: session.siteId,
        });
      }
    });

    sock.on('disconnect', () => console.log(`[socket:${label}] disconnected`));

    const EVENTS = [
      'alert:new',
      'alert:ack',
      'alert:ackAll',
      'telemetry:reading',
      'site:update',
      'site:new',
      'site:delete',
      'device:offline',
      'device:online',
      'complaint:new',
      'complaint:update',
    ];

    EVENTS.forEach((ev) => {
      sock.on(ev, (payload) => {
        (listeners[ev] || []).forEach((cb) => {
          try { cb(payload); } catch (e) { console.warn(e); }
        });
      });
    });
  };

  socket = io(targetUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
  });
  attachEvents(socket, 'primary');

  if (!isLocal && secondaryUrl !== targetUrl) {
    fallbackSocket = io(secondaryUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000,
    });
    attachEvents(fallbackSocket, 'secondary');
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (fallbackSocket) {
    fallbackSocket.disconnect();
    fallbackSocket = null;
  }
}

export function onSocket(event, cb) {
  listeners[event] = listeners[event] || [];
  listeners[event].push(cb);
  return () => {
    listeners[event] = (listeners[event] || []).filter((x) => x !== cb);
  };
}