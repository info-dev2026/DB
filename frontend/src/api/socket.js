/* ============================================================
   Socket.IO client — listens to real-time events from backend
   ============================================================ */
import { io } from 'socket.io-client';

const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1');

export function getSocketUrl() {
  try {
    const custom = localStorage.getItem('sz_socket_url');
    if (custom && custom.trim()) {
      if (
        custom.includes('onrender.com') ||
        (!isLocal && (custom.includes('localhost') || custom.includes('127.0.0.1')))
      ) {
        localStorage.removeItem('sz_socket_url');
      } else {
        return custom.trim();
      }
    }
  } catch {}

  if (process.env.REACT_APP_SOCKET_URL && !process.env.REACT_APP_SOCKET_URL.includes('render.com')) {
    return process.env.REACT_APP_SOCKET_URL;
  }

  return 'https://saaphzone-backend.azurewebsites.net';
}

export const SOCKET_URL = getSocketUrl();

let socket = null;
const listeners = {};

/* ---------- Connect once, reuse ---------- */
export function connectSocket(session) {
  if (socket) return socket;

  const targetUrl = getSocketUrl();
  socket = io(targetUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    console.log('[socket] connected');
    /* Join the right room — admins get everything, industry gets their own site */
    if (session) {
      socket.emit('join', {
        role: session.role,
        siteId: session.siteId,
      });
    }
  });

  socket.on('disconnect', () => console.log('[socket] disconnected'));

  /* Re-emit into our own listener bus so components can subscribe */
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
    socket.on(ev, (payload) => {
      (listeners[ev] || []).forEach((cb) => {
        try { cb(payload); } catch (e) { console.warn(e); }
      });
    });
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function onSocket(event, cb) {
  listeners[event] = listeners[event] || [];
  listeners[event].push(cb);
  return () => {
    listeners[event] = (listeners[event] || []).filter((x) => x !== cb);
  };
}