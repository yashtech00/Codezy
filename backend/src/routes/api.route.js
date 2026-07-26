const express = require('express');
const prisma = require('../config/db');
const { addReviewJob } = require('../queue/reviewQueue');

const router = express.Router();

// GET /api/reviews - List recent PR reviews for Dashboard
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
    console.error('[API] Failed to fetch reviews:', error.message);
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
    console.error('[API] Failed to fetch review:', error.message);
    res.status(500).json({ error: 'Failed to fetch review' });
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
    console.error('[API] Test trigger failed:', error.message);
    res.status(500).json({ error: 'Failed to trigger test review' });
  }
});

module.exports = router;
