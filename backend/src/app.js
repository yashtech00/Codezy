const express = require('express');
const cors = require('cors');
const webhookRoute = require('./routes/webhook.route');
const apiRoute = require('./routes/api.route');
const config = require('./config/env');

const app = express();

app.use(cors({
  origin: [config.frontendUrl, 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));

// Apply raw body parser ONLY to the GitHub webhook route so HMAC verification gets untouched bytes
app.use(
  '/webhook/github',
  express.raw({ type: 'application/json' })
);
app.use('/webhook', webhookRoute);

// Standard JSON body parser for dashboard REST API routes
app.use(express.json());
app.use('/api', apiRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'AutoReview Backend API', timestamp: new Date().toISOString() });
});

module.exports = app;
