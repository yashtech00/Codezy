const express = require('express');
const verifySignature = require('../middleware/verifySignature');
const { addReviewJob } = require('../queue/reviewQueue');
const prisma = require('../config/db');

const router = express.Router();

router.post('/github', verifySignature, async (req, res) => {
  const eventType = req.headers['x-github-event'];
  let payload;

  try {
    payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
  } catch (err) {
    console.error('❌ [Webhook Error] Failed to parse JSON payload:', err.message);
    return res.status(400).send('Invalid JSON payload');
  }

  // Respond fast to GitHub (under 10s ACK)
  res.status(200).send('OK');

  console.log(`📌 [Webhook Parsed] Event: '${eventType}', Action: '${payload.action || 'none'}'`);

  if (eventType === 'ping') {
    console.log(`ℹ️ [Webhook Info] Received GitHub 'ping' event. GitHub App connection is active.`);
    return;
  }

  if (eventType !== 'pull_request') {
    console.log(`ℹ️ [Webhook Ignored] Event '${eventType}' is not 'pull_request'.`);
    return;
  }

  if (!['opened', 'synchronize', 'reopened'].includes(payload.action)) {
    console.log(`ℹ️ [Webhook Ignored] Action '${payload.action}' is not opened/synchronize/reopened.`);
    return;
  }

  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  const headSha = payload.pull_request.head.sha;
  const diffUrl = payload.pull_request.diff_url;

  console.log(`🚀 [PR Event Triggered] Repo: ${repoFullName}, PR #${prNumber}, Action: ${payload.action}, Installation ID: ${installationId}`);

  try {
    // 1. Ensure Installation record exists in Prisma DB
    let installationRecord = null;
    if (installationId) {
      installationRecord = await prisma.installation.upsert({
        where: { githubInstallationId: Number(installationId) },
        update: { repoList: [repoFullName] },
        create: {
          githubInstallationId: Number(installationId),
          repoList: [repoFullName],
          planType: 'FREE',
        },
      });
      console.log(`💾 [Prisma DB] Updated installation record: ID=${installationRecord.id}`);
    }

    // 2. Create PrReview record in Prisma DB
    const reviewRecord = await prisma.prReview.create({
      data: {
        prNumber,
        repoFullName,
        headSha,
        diffUrl,
        status: 'QUEUED',
        installationId: installationRecord?.id || null,
      },
    });

    console.log(`💾 [Prisma DB] Created PrReview record: ${reviewRecord.id}`);

    // 3. Enqueue BullMQ worker job
    await addReviewJob({
      reviewId: reviewRecord.id,
      repoFullName,
      prNumber,
      installationId: installationId ? Number(installationId) : null,
      headSha,
      diffUrl,
    });

    console.log(`📥 [BullMQ Enqueued] Job pushed for PR #${prNumber} (${repoFullName})`);
  } catch (err) {
    console.error('❌ [Webhook Error] Failed to process webhook or enqueue job:', err);
  }
});

module.exports = router;
