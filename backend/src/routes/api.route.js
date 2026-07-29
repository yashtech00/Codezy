import express from 'express';
import prisma from '../config/db.js';
import { addReviewJob } from '../queue/reviewQueue.js';
import { logger } from '../shared/logger.js';

const router = express.Router();

// GET /api/reviews - List recent PR reviews for Dashboard (backward compatible)
router.get('/reviews', async (req, res) => {
  try {
    const reviews = await prisma.prReview.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        agentRuns: true,
      },
    });
    res.json({ reviews });
  } catch (error) {
    logger.error('Failed to fetch reviews', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// GET /api/reviews/:id - Get single PR review details & agent runs
router.get('/reviews/:id', async (req, res) => {
  try {
    const review = await prisma.prReview.findUnique({
      where: { id: req.params.id },
      include: {
        agentRuns: true,
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json({ review });
  } catch (error) {
    logger.error('Failed to fetch review', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch review' });
  }
});

// ── LEVEL 2 ENDPOINTS ──────────────────────────────────────────

// GET /api/repositories - List repositories
router.get('/repositories', async (req, res) => {
  try {
    const repositories = await prisma.repository.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        pullRequests: {
          take: 5,
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    res.json({ repositories });
  } catch (error) {
    logger.error('Failed to fetch repositories', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// GET /api/pull-requests/:id - Pull Request details and Findings
router.get('/pull-requests/:id', async (req, res) => {
  try {
    const pullRequest = await prisma.pullRequest.findUnique({
      where: { id: req.params.id },
      include: {
        repository: true,
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        findings: {
          include: {
            occurrences: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            feedback: true,
          },
        },
      },
    });

    if (!pullRequest) {
      return res.status(404).json({ error: 'Pull request not found' });
    }

    res.json({ pullRequest });
  } catch (error) {
    logger.error('Failed to fetch pull request', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch pull request' });
  }
});

// GET /api/review-attempts/:id - Detailed review attempt
router.get('/review-attempts/:id', async (req, res) => {
  try {
    const attempt = await prisma.reviewAttempt.findUnique({
      where: { id: req.params.id },
      include: {
        pullRequest: {
          include: { repository: true },
        },
        occurrences: {
          include: { finding: true },
        },
        usageRecords: true,
      },
    });

    if (!attempt) {
      return res.status(404).json({ error: 'Review attempt not found' });
    }

    res.json({ attempt });
  } catch (error) {
    logger.error('Failed to fetch review attempt', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch review attempt' });
  }
});

// POST /api/findings/:id/feedback - Add feedback for finding
router.post('/findings/:id/feedback', async (req, res) => {
  const { action, reason, userId = 'user_demo', source = 'DASHBOARD' } = req.body;

  if (!action || !['HELPFUL', 'FALSE_POSITIVE', 'WONT_FIX'].includes(action)) {
    return res.status(400).json({ error: 'Invalid feedback action' });
  }

  try {
    const feedback = await prisma.findingFeedback.create({
      data: {
        findingId: req.params.id,
        userId,
        action,
        reason: reason || null,
        source,
      },
    });

    res.json({ message: 'Feedback recorded successfully', feedback });
  } catch (error) {
    logger.error('Failed to record feedback', { error: error.message });
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

// POST /api/findings/:id/dismiss - Dismiss finding
router.post('/findings/:id/dismiss', async (req, res) => {
  const { reason = 'Dismissed by developer' } = req.body;

  try {
    const updatedFinding = await prisma.finding.update({
      where: { id: req.params.id },
      data: {
        currentStatus: 'DISMISSED',
        dismissedReason: reason,
      },
    });

    res.json({ message: 'Finding dismissed', finding: updatedFinding });
  } catch (error) {
    logger.error('Failed to dismiss finding', { error: error.message });
    res.status(500).json({ error: 'Failed to dismiss finding' });
  }
});

// POST /api/test-trigger - Manually trigger a mock PR review for dashboard demonstration
router.post('/test-trigger', async (req, res) => {
  const { repoFullName = 'yashtech00/Codezy', prNumber = 1, headSha = '492de6d' } = req.body;

  try {
    const existingInstallation = await prisma.installation.findFirst();
    const installationId = existingInstallation ? existingInstallation.githubInstallationId : null;

    const reviewRecord = await prisma.prReview.create({
      data: {
        prNumber: Number(prNumber),
        repoFullName,
        headSha,
        status: 'QUEUED',
        installationId: existingInstallation?.id || null,
      },
    });

    await addReviewJob({
      reviewId: reviewRecord.id,
      repoFullName,
      prNumber: Number(prNumber),
      installationId,
      headSha,
    });

    res.json({ message: 'Triggered mock PR review successfully', review: reviewRecord });
  } catch (error) {
    logger.error('Test trigger failed', { error: error.message });
    res.status(500).json({ error: 'Failed to trigger test review' });
  }
});

export default router;
