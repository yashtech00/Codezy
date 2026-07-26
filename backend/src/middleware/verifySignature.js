const crypto = require('crypto');
const config = require('../config/env');

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  // Skip signature verification if bypass header is passed in development/testing
  if (process.env.NODE_ENV === 'development' && req.headers['x-bypass-signature'] === 'true') {
    return next();
  }

  if (!signature) {
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  if (!req.body || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: 'Raw request body buffer required for signature verification' });
  }

  const hmac = crypto.createHmac('sha256', config.github.webhookSecret);
  const digest = 'sha256=' + hmac.update(req.body).digest('hex');

  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(signature, 'utf8');

  if (expected.length !== received.length) {
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  const isValid = crypto.timingSafeEqual(expected, received);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  next();
}

module.exports = verifySignature;
