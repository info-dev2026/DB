const logger = require('../utils/logger');

let io = null;

/* -----------------------------------------------------------------
   Initialize Socket.IO — called once from server.js
   ----------------------------------------------------------------- */
function initSocket(server) {
  io = server;

  io.on('connection', (socket) => {
    logger.info(`🔌 socket connected: ${socket.id}`);

    /* Client tells us who it is — we join it to the right "room" */
    socket.on('join', ({ role, siteId } = {}) => {
      if (role === 'industry' && siteId) {
        socket.join('site:' + siteId);
        logger.info(`   ${socket.id} joined site:${siteId}`);
      } else {
        socket.join('admins');
        logger.info(`   ${socket.id} joined admins`);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`🔌 socket disconnected: ${socket.id}`);
    });
  });
}

/* -----------------------------------------------------------------
   Broadcast an event
   - room omitted  → broadcast to everyone
   - room provided → only to that room (e.g. 'admins' or 'site:ESK-4417')
   ----------------------------------------------------------------- */
function broadcast(event, payload, room) {
  if (!io) return;
  if (room) io.to(room).emit(event, payload);
  else io.emit(event, payload);
}

/* Broadcast to a specific site — helper */
function toSite(siteId, event, payload) {
  if (!io) return;
  io.to('site:' + siteId).emit(event, payload);
}

/* Broadcast to all admin/engineer/sales users */
function toAdmins(event, payload) {
  if (!io) return;
  io.to('admins').emit(event, payload);
}

module.exports = { initSocket, broadcast, toSite, toAdmins };