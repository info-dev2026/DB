/* ============================================================
   Socket.IO client — listens to real-time events from backend
   ============================================================ */
import { io } from 'socket.io-client';

export const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

let socket = null;
const listeners = {};

/* ---------- Connect once, reuse ---------- */
export function connectSocket(session) {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
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