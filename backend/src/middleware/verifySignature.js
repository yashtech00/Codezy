import crypto from 'crypto';
import config from '../config/env.js';

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'] || 'unknown';

  console.log(`\n--------------------------------------------------`);
  console.log(`📬 [Webhook Received] Event: '${event}'`);

  if (process.env.NODE_ENV === 'development' && req.headers['x-bypass-signature'] === 'true') {
    console.log(`⚠️ [Signature] Bypassing signature verification due to x-bypass-signature header`);
    return next();
  }

  if (!signature) {
    console.error(`❌ [Signature Error] Missing X-Hub-Signature-256 header`);
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  if (!req.body || !Buffer.isBuffer(req.body)) {
    console.error(`❌ [Signature Error] Request body is not a raw buffer`);
    return res.status(400).json({ error: 'Raw request body buffer required' });
  }

  const hmac = crypto.createHmac('sha256', config.github.webhookSecret);
  const digest = 'sha256=' + hmac.update(req.body).digest('hex');

  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(signature, 'utf8');

  if (expected.length !== received.length) {
    console.error(`❌ [Signature Error] Length mismatch. Received signature format mismatch.`);
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  const isValid = crypto.timingSafeEqual(expected, received);
  if (!isValid) {
    console.error(`❌ [Signature Error] HMAC verification failed! Check GITHUB_WEBHOOK_SECRET in .env`);
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  console.log(`✅ [Signature Passed] Webhook HMAC signature verified successfully.`);
  next();
}

export default verifySignature;

