import express from 'express';
import cors from 'cors';
import webhookRoute from './routes/webhook.route.js';
import apiRoute from './routes/api.route.js';
import config from './config/env.js';
import authRoute from './routes/auth.route.js';

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

// Standard JSON body parser for dashboard & auth REST API routes
app.use(express.json());
app.use('/api/auth', authRoute);
app.use('/api', authRoute);
app.use('/api', apiRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'AutoReview Backend API', timestamp: new Date().toISOString() });
});

export default app;

