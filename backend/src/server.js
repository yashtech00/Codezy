import './config/env.js';
import http from 'http';
import app from './app.js';
import { initSocket } from './config/socket.js';
import { port } from './config/env.js';

// Start BullMQ worker process
import Worker from './queue/reviewWorker.js';

const server = http.createServer(app);

// Initialize Socket.io server
initSocket(server);

server.listen(port, () => {
  console.log(`=================================================`);
  console.log(`🚀 AutoReview Webhook & API Server running on port ${port}`);
  console.log(`🔌 Socket.io server initialized`);
  console.log(`📬 Webhook Endpoint: http://localhost:${port}/webhook/github`);
  console.log(`📊 REST API Endpoint: http://localhost:${port}/api/reviews`);
  console.log(`=================================================`);
});
