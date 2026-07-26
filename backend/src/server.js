require('./config/env');
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const { port } = require('./config/env');

// Start BullMQ worker process
require('./queue/reviewWorker');

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
