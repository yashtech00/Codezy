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
    return res.status(400).send('Invalid JSON payload');
  }

  // Respond fast to GitHub (under 10s ACK)
  res.status(200).send('OK');

  if (eventType !== 'pull_request') return;
  if (!['opened', 'synchronize'].includes(payload.action)) return;

  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  const headSha = payload.pull_request.head.sha;
  const diffUrl = payload.pull_request.diff_url;

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

    // 3. Enqueue BullMQ worker job
    await addReviewJob({
      reviewId: reviewRecord.id,
      repoFullName,
      prNumber,
      installationId: installationId ? Number(installationId) : null,
      headSha,
      diffUrl,
    });

    console.log(`[Webhook] Enqueued PR review #${prNumber} for ${repoFullName} (Review ID: ${reviewRecord.id})`);
  } catch (err) {
    console.error('[Webhook] Error enqueuing review job:', err);
  }
});

module.exports = router;
