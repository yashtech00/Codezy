import express from 'express';
import crypto from 'crypto';
import verifySignature from '../middleware/verifySignature.js';
import { addReviewJob } from '../queue/reviewQueue.js';
import prisma from '../config/db.js';
import { logger } from '../shared/logger.js';

const router = express.Router();

router.post('/github', verifySignature, async (req, res) => {
  const eventType = req.headers['x-github-event'];
  const deliveryId = req.headers['x-github-delivery'];
  let payload;

  try {
    payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
  } catch (err) {
    logger.error('Failed to parse JSON payload', { error: err.message });
    return res.status(400).send('Invalid JSON payload');
  }

  // ── Webhook Delivery Idempotency Check ─────────────────────
  if (deliveryId) {
    try {
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      
      const existingDelivery = await prisma.webhookDelivery.findUnique({
        where: { githubDeliveryId: deliveryId },
      });

      if (existingDelivery) {
        logger.info('Duplicate webhook delivery received — skipping re-processing', { deliveryId, eventType });
        return res.status(200).send('OK (Duplicate delivery skipped)');
      }

      await prisma.webhookDelivery.create({
        data: {
          githubDeliveryId: deliveryId,
          event: eventType || 'unknown',
          action: payload.action || null,
          installationGithubId: payload.installation?.id ? BigInt(payload.installation.id) : null,
          repositoryGithubId: payload.repository?.id ? BigInt(payload.repository.id) : null,
          payloadHash,
          status: 'PROCESSING',
        },
      });
    } catch (dbErr) {
      logger.warn('Webhook delivery idempotency check fallback', { error: dbErr.message });
    }
  }

  // Respond fast to GitHub (under 10s ACK)
  res.status(200).send('OK');

  logger.info(`Webhook Received`, { eventType, action: payload.action || 'none', deliveryId });

  if (eventType === 'ping') {
    logger.info('GitHub ping event acknowledged');
    return;
  }

  // ── Handle GitHub App Installation Events ─────────────────
  if (eventType === 'installation') {
    const installationId = payload.installation?.id;
    const action = payload.action;
    const accountUsername = payload.installation?.account?.login || null;
    const accountType = payload.installation?.account?.type || 'User';

    if (!installationId) return;

    try {
      if (action === 'created') {
        const repoList = Array.isArray(payload.repositories)
          ? payload.repositories.map(r => r.full_name)
          : [];

        const matchingUser = accountUsername
          ? await prisma.user.findFirst({ where: { username: accountUsername } })
          : null;

        await prisma.installation.upsert({
          where: { githubInstallationId: Number(installationId) },
          update: {
            accountUsername,
            accountType,
            repoList,
            status: 'ACTIVE',
            userId: matchingUser ? matchingUser.id : undefined,
          },
          create: {
            githubInstallationId: Number(installationId),
            accountUsername,
            accountType,
            repoList,
            status: 'ACTIVE',
            userId: matchingUser ? matchingUser.id : null,
          },
        });
        logger.info(`GitHub App Installation registered/activated`, { installationId });
      } else if (action === 'deleted') {
        await prisma.installation.updateMany({
          where: { githubInstallationId: Number(installationId) },
          data: { status: 'DELETED' },
        });
        logger.info(`GitHub App Installation marked DELETED`, { installationId });
      } else if (action === 'suspend' || action === 'unsuspend') {
        const newStatus = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
        await prisma.installation.updateMany({
          where: { githubInstallationId: Number(installationId) },
          data: { status: newStatus },
        });
        logger.info(`GitHub App Installation status updated`, { installationId, newStatus });
      }
    } catch (err) {
      logger.error('Error handling installation webhook', { error: err.message });
    }
    return;
  }

  // ── Handle Installation Repositories Changed Events ────────
  if (eventType === 'installation_repositories') {
    const installationId = payload.installation?.id;
    if (!installationId) return;

    try {
      const addedRepos = (payload.repositories_added || []).map(r => r.full_name);
      const removedRepos = (payload.repositories_removed || []).map(r => r.full_name);

      const existing = await prisma.installation.findUnique({
        where: { githubInstallationId: Number(installationId) },
      });

      if (existing) {
        let currentRepos = Array.isArray(existing.repoList) ? existing.repoList : [];
        currentRepos = [...new Set([...currentRepos, ...addedRepos])].filter(r => !removedRepos.includes(r));

        await prisma.installation.update({
          where: { githubInstallationId: Number(installationId) },
          data: { repoList: currentRepos },
        });
        logger.info(`Updated repos for Installation`, { installationId, count: currentRepos.length });
      }
    } catch (err) {
      logger.error('Error handling installation repos webhook', { error: err.message });
    }
    return;
  }

  // ── Handle Pull Request Events ────────────────────────────
  if (eventType !== 'pull_request') {
    return;
  }

  if (!['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(payload.action)) {
    return;
  }

  // Check draft handling
  if (payload.pull_request.draft === true && payload.action !== 'ready_for_review') {
    logger.info(`Skipping draft PR #${payload.pull_request.number}`);
    return;
  }

  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  const headSha = payload.pull_request.head.sha;
  const baseSha = payload.pull_request.base.sha;
  const diffUrl = payload.pull_request.diff_url;
  const repoGithubId = payload.repository.id;

  logger.info(`Processing PR Event`, { repoFullName, prNumber, action: payload.action, headSha });

  try {
    // 1. Installation Upsert
    let installationRecord = null;
    if (installationId) {
      installationRecord = await prisma.installation.upsert({
        where: { githubInstallationId: Number(installationId) },
        update: {
          repoList: [repoFullName],
          status: 'ACTIVE',
        },
        create: {
          githubInstallationId: Number(installationId),
          accountUsername: payload.repository.owner?.login || null,
          repoList: [repoFullName],
          status: 'ACTIVE',
          planType: 'FREE',
        },
      });
    }

    // 2. Level 2 Repository Upsert
    let repositoryRecord = null;
    if (installationRecord) {
      repositoryRecord = await prisma.repository.upsert({
        where: { githubRepositoryId: BigInt(repoGithubId) },
        update: {
          fullName: repoFullName,
          defaultBranch: payload.repository.default_branch || 'main',
          private: payload.repository.private || false,
        },
        create: {
          githubRepositoryId: BigInt(repoGithubId),
          fullName: repoFullName,
          defaultBranch: payload.repository.default_branch || 'main',
          private: payload.repository.private || false,
          installationId: installationRecord.id,
        },
      });
    }

    // 3. Level 2 PullRequest Upsert
    let pullRequestRecord = null;
    if (repositoryRecord) {
      pullRequestRecord = await prisma.pullRequest.upsert({
        where: {
          repositoryId_githubPrNumber: {
            repositoryId: repositoryRecord.id,
            githubPrNumber: prNumber,
          },
        },
        update: {
          state: payload.pull_request.state || 'open',
          draft: payload.pull_request.draft || false,
          baseSha,
          headSha,
          authorLogin: payload.pull_request.user?.login || null,
        },
        create: {
          repositoryId: repositoryRecord.id,
          githubPrNumber: prNumber,
          state: payload.pull_request.state || 'open',
          draft: payload.pull_request.draft || false,
          baseSha,
          headSha,
          authorLogin: payload.pull_request.user?.login || null,
        },
      });

      // 4. Level 2 ReviewAttempt Creation
      const previousAttempt = await prisma.reviewAttempt.findFirst({
        where: { pullRequestId: pullRequestRecord.id },
        orderBy: { createdAt: 'desc' },
      });

      await prisma.reviewAttempt.upsert({
        where: {
          pullRequestId_headSha: {
            pullRequestId: pullRequestRecord.id,
            headSha,
          },
        },
        update: {
          triggerAction: payload.action,
          status: 'QUEUED',
          previousHeadSha: previousAttempt ? previousAttempt.headSha : null,
        },
        create: {
          pullRequestId: pullRequestRecord.id,
          baseSha,
          headSha,
          previousHeadSha: previousAttempt ? previousAttempt.headSha : null,
          triggerAction: payload.action,
          status: 'QUEUED',
          configurationSnapshot: {},
        },
      });
    }

    // 5. Backward Compatible PrReview Record
    const existingReview = await prisma.prReview.findFirst({
      where: { repoFullName, prNumber },
      orderBy: { createdAt: 'desc' },
    });
    const reviewCount = (existingReview?.reviewCount ?? 0) + 1;

    const reviewRecord = await prisma.prReview.create({
      data: {
        prNumber,
        repoFullName,
        headSha,
        diffUrl,
        status: 'QUEUED',
        reviewCount,
        installationId: installationRecord?.id || null,
      },
    });

    // 6. Enqueue BullMQ worker job
    await addReviewJob({
      reviewId: reviewRecord.id,
      repoFullName,
      prNumber,
      installationId: installationId ? Number(installationId) : null,
      headSha,
      diffUrl,
      reviewCount,
    });

    if (deliveryId) {
      await prisma.webhookDelivery.update({
        where: { githubDeliveryId: deliveryId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      }).catch(() => {});
    }

    logger.info('Review job enqueued successfully', { prNumber, repoFullName, reviewId: reviewRecord.id });
  } catch (err) {
    logger.error('Failed to process PR webhook', { error: err.message });
    if (deliveryId) {
      await prisma.webhookDelivery.update({
        where: { githubDeliveryId: deliveryId },
        data: { status: 'FAILED', failureMessage: err.message },
      }).catch(() => {});
    }
  }
});

export default router;
