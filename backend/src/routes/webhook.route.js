import express from 'express';
import verifySignature from '../middleware/verifySignature.js';
import { addReviewJob } from '../queue/reviewQueue.js';
import prisma from '../config/db.js';

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

  // ── Handle GitHub App Installation Events ─────────────────
  if (eventType === 'installation') {
    const installationId = payload.installation?.id;
    const action = payload.action;
    const accountUsername = payload.installation?.account?.login || null;
    const accountType = payload.installation?.account?.type || 'User';

    if (!installationId) return;

    console.log(`⚙️ [Webhook Installation] Action: ${action}, Installation ID: ${installationId}, Account: ${accountUsername}`);

    try {
      if (action === 'created') {
        const repoList = Array.isArray(payload.repositories)
          ? payload.repositories.map(r => r.full_name)
          : [];

        // Check if there is a matching platform user
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
        console.log(`✅ [Prisma DB] GitHub App Installation ${installationId} registered/activated in DB.`);
      } else if (action === 'deleted') {
        await prisma.installation.updateMany({
          where: { githubInstallationId: Number(installationId) },
          data: { status: 'DELETED' },
        });
        console.log(`🗑️ [Prisma DB] GitHub App Installation ${installationId} marked DELETED in DB.`);
      } else if (action === 'suspend' || action === 'unsuspend') {
        const newStatus = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
        await prisma.installation.updateMany({
          where: { githubInstallationId: Number(installationId) },
          data: { status: newStatus },
        });
        console.log(`⏸️ [Prisma DB] GitHub App Installation ${installationId} status updated to ${newStatus}.`);
      }
    } catch (err) {
      console.error('❌ [Webhook Installation Error]:', err);
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
        // Add new, filter removed
        currentRepos = [...new Set([...currentRepos, ...addedRepos])].filter(r => !removedRepos.includes(r));

        await prisma.installation.update({
          where: { githubInstallationId: Number(installationId) },
          data: { repoList: currentRepos },
        });
        console.log(`🔄 [Prisma DB] Updated repos for Installation ${installationId}: ${currentRepos.length} repos active.`);
      }
    } catch (err) {
      console.error('❌ [Webhook Installation Repos Error]:', err);
    }
    return;
  }

  // ── Handle Pull Request Events ────────────────────────────
  if (eventType !== 'pull_request') {
    console.log(`ℹ️ [Webhook Ignored] Event '${eventType}' is not 'pull_request', 'installation', or 'ping'.`);
    return;
  }

  if (!['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(payload.action)) {
    console.log(`ℹ️ [Webhook Ignored] Action '${payload.action}' is not a reviewable PR action.`);
    return;
  }

  // Skip draft PRs
  if (payload.pull_request.draft === true && payload.action !== 'ready_for_review') {
    console.log(`⏭️ [Webhook Skipped] PR #${payload.pull_request.number} is a DRAFT — skipping review.`);
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
      console.log(`💾 [Prisma DB] Updated installation record: ID=${installationRecord.id}`);
    }

    // 2. Create PrReview record in Prisma DB
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

    console.log(`💾 [Prisma DB] Created PrReview record: ${reviewRecord.id}`);

    // 3. Enqueue BullMQ worker job
    await addReviewJob({
      reviewId: reviewRecord.id,
      repoFullName,
      prNumber,
      installationId: installationId ? Number(installationId) : null,
      headSha,
      diffUrl,
      reviewCount,
    });

    console.log(`📥 [BullMQ Enqueued] Job pushed for PR #${prNumber} (${repoFullName})`);
  } catch (err) {
    console.error('❌ [Webhook Error] Failed to process webhook or enqueue job:', err);
  }
});

export default router;

