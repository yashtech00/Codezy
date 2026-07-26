const { Server } = require('socket.io');
const config = require('./env');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: [config.frontendUrl, 'http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on('subscribe', ({ reviewId }) => {
      if (reviewId) {
        socket.join(`review:${reviewId}`);
        console.log(`[Socket.io] Client ${socket.id} subscribed to room review:${reviewId}`);
      }
    });

    socket.on('unsubscribe', ({ reviewId }) => {
      if (reviewId) {
        socket.leave(`review:${reviewId}`);
        console.log(`[Socket.io] Client ${socket.id} unsubscribed from room review:${reviewId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitAgentStatus(reviewId, agentData) {
  if (io) {
    io.to(`review:${reviewId}`).emit(`agent-status:${reviewId}`, agentData);
    // Also emit broadcast event for real-time dashboards
    io.emit('agent-status-global', { reviewId, ...agentData });
  }
}

module.exports = {
  initSocket,
  getIO,
  emitAgentStatus,
};
