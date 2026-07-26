AutoReview — Week 1
Code Structure: GitHub App Setup, Webhook Receiver, Signature Verification, Basic Queue Push
1. Project Folder Structure
autoreview/
├── src/
│   ├── config/
│   │   └── env.js              # env variable loading + validation
│   ├── routes/
│   │   └── webhook.route.js     # POST /webhook/github
│   ├── middleware/
│   │   └── verifySignature.js   # HMAC signature check
│   ├── queue/
│   │   ├── connection.js        # Redis connection config
│   │   ├── reviewQueue.js       # BullMQ Queue definition
│   │   └── reviewWorker.js      # BullMQ Worker (basic skeleton)
│   ├── services/
│   │   └── github.service.js    # GitHub API/JWT helpers (stub for Week 1)
│   ├── app.js                   # Express app setup
│   └── server.js                # entry point — starts app + worker
├── .env.example
├── .gitignore
├── package.json
└── docker-compose.yml           # Redis for local dev
Har concern apni file me — webhook route sirf HTTP handle kare, signature check middleware me ho, queue logic alag file me. Isse Week 2+ me diff-fetching aur agents add karna easy hoga bina existing code chhede.
2. Environment Variables
.env.example
PORT=3000
 
# GitHub App
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_PRIVATE_KEY_PATH=./keys/github-app-private-key.pem
 
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
src/config/env.js
require('dotenv').config();
 
const required = [
  'GITHUB_APP_ID',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_PRIVATE_KEY_PATH',
];
 
// Fail fast on boot if config is missing — better than a runtime
// crash the first time a webhook actually arrives.
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
 
module.exports = {
  port: process.env.PORT || 3000,
  github: {
    appId: process.env.GITHUB_APP_ID,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  },
};
3. Signature Verification Middleware
src/middleware/verifySignature.js
const crypto = require('crypto');
const { github } = require('../config/env');
 
function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
 
  if (!signature) {
    return res.status(401).send('Missing signature header');
  }
 
  const hmac = crypto.createHmac('sha256', github.webhookSecret);
  // req.body must be the RAW buffer here — see app.js for why
  const digest = 'sha256=' + hmac.update(req.body).digest('hex');
 
  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(signature, 'utf8');
 
  // Lengths must match before timingSafeEqual — it throws on
  // mismatched buffer lengths instead of returning false.
  if (expected.length !== received.length) {
    return res.status(401).send('Invalid signature');
  }
 
  const isValid = crypto.timingSafeEqual(expected, received);
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
 
  next();
}
 
module.exports = verifySignature;
timingSafeEqual constant-time comparison karta hai — normal === use karne se timing attack ka risk rehta hai jisse secret guess kiya ja sakta hai.
4. Webhook Route
src/routes/webhook.route.js
const express = require('express');
const verifySignature = require('../middleware/verifySignature');
const { addReviewJob } = require('../queue/reviewQueue');
 
const router = express.Router();
 
// NOTE: express.raw() is applied to this route specifically in app.js
// — NOT express.json() — because signature verification needs the
// exact raw bytes GitHub signed, not a re-serialized JSON object.
router.post('/github', verifySignature, async (req, res) => {
  const eventType = req.headers['x-github-event'];
  const payload = JSON.parse(req.body);
 
  // Respond fast — GitHub expects an ack within ~10s or it retries.
  res.status(200).send('OK');
 
  if (eventType !== 'pull_request') return;
  if (!['opened', 'synchronize'].includes(payload.action)) return;
 
  try {
    await addReviewJob({
      repoFullName: payload.repository.full_name,
      prNumber: payload.pull_request.number,
      installationId: payload.installation.id,
      headSha: payload.pull_request.head.sha,
      diffUrl: payload.pull_request.diff_url,
    });
  } catch (err) {
    // Already responded 200 to GitHub — just log for now.
    // Week 2+: push to a dead-letter log / alerting.
    console.error('Failed to enqueue review job:', err);
  }
});
 
module.exports = router;
5. Redis Connection + Queue
src/queue/connection.js
const { redis } = require('../config/env');
 
// Shared connection config — reused by both Queue and Worker
// so they don't drift out of sync.
module.exports = {
  host: redis.host,
  port: redis.port,
};
src/queue/reviewQueue.js
const { Queue } = require('bullmq');
const connection = require('./connection');
 
const QUEUE_NAME = 'pr-review-queue';
 
const reviewQueue = new Queue(QUEUE_NAME, { connection });
 
async function addReviewJob(jobData) {
  return reviewQueue.add('review-pr', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false, // keep failed jobs around for debugging
  });
}
 
module.exports = { reviewQueue, addReviewJob, QUEUE_NAME };
src/queue/reviewWorker.js
const { Worker } = require('bullmq');
const connection = require('./connection');
const { QUEUE_NAME } = require('./reviewQueue');
 
// Week 1 scope: just prove the job reaches a worker.
// Week 2+ will replace the body with diff fetch -> LangGraph agents.
const reviewWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[worker] picked up PR #${job.data.prNumber} ` +
      `on ${job.data.repoFullName}`);
    // TODO Week 2: fetch diff, filter files
    // TODO Week 4: run LangGraph supervisor + agents
  },
  { connection, concurrency: 5 }
);
 
reviewWorker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed`);
});
 
reviewWorker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});
 
module.exports = reviewWorker;
6. Express App + Entry Point
src/app.js
const express = require('express');
const webhookRoute = require('./routes/webhook.route');
 
const app = express();
 
// IMPORTANT: raw body ONLY on the webhook path, applied before
// any express.json() elsewhere, so the signature check gets the
// exact bytes GitHub hashed.
app.use(
  '/webhook/github',
  express.raw({ type: 'application/json' })
);
app.use('/webhook', webhookRoute);
 
// Any other routes (dashboard API, etc.) can safely use express.json()
app.use(express.json());
 
app.get('/health', (req, res) => res.send('ok'));
 
module.exports = app;
src/server.js
require('./config/env'); // validates env vars on boot, fails fast
const app = require('./app');
require('./queue/reviewWorker'); // starts the worker alongside the server
 
const { port } = require('./config/env');
 
app.listen(port, () => {
  console.log(`AutoReview webhook server listening on port ${port}`);
});
7. package.json
{
  "name": "autoreview",
  "version": "0.1.0",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  },
  "dependencies": {
    "bullmq": "^5.0.0",
    "dotenv": "^16.4.0",
    "express": "^4.19.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
8. docker-compose.yml (local Redis)
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
9. Local Testing Flow
•	Start Redis: docker-compose up -d
•	Start the server: npm run dev
•	Expose localhost via smee.io or ngrok, point the GitHub App's webhook URL at the forwarded URL
•	Open a test PR on a repo where the app is installed, or use “Redeliver” on an existing delivery from the GitHub App's Advanced → Recent Deliveries tab
•	Confirm in terminal: signature passes → job enqueued → worker logs “picked up PR #...”
10. What's Deliberately Deferred to Week 2+
•	GitHub API calls (JWT-based app auth, fetching the actual diff) — github.service.js is just a stub folder for now
•	Rate limiting / per-installation throttling on the queue
•	LangGraph supervisor and agents — the worker currently only logs
•	Persisting jobs/results to Postgres — no DB layer yet in Week 1
