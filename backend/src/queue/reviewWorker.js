const { Worker } = require('bullmq');
const connection = require('./connection');
const { QUEUE_NAME } = require('./reviewQueue');
const prisma = require('../config/db');
const { emitAgentStatus } = require('../config/socket');
const { fetchPrDiff, postPrComment } = require('../services/github.service');
const { preprocessDiff, calculateDiffStats } = require('../services/diffPreprocessor');
const {
  runSupervisorNode,
  runStyleAgent,
  runSecurityAgent,
  calculateSeverityScore,
  formatMarkdownComment,
} = require('../agents/reviewAgents');

const reviewWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { reviewId, repoFullName, prNumber, installationId, headSha } = job.data;

    console.log(`[worker] Processing PR #${prNumber} for ${repoFullName} (Review ID: ${reviewId})`);

    // 1. Update PrReview status to RUNNING in Prisma
    if (reviewId) {
      await prisma.prReview.update({
        where: { id: reviewId },
        data: { status: 'RUNNING' },
      }).catch(err => console.error('[worker] Failed DB update to RUNNING:', err.message));
    }

    emitAgentStatus(reviewId, { agent: 'supervisor', status: 'running', message: 'Analyzing diff size and file types' });

    // 2. Fetch & Preprocess PR diff
    const [owner, repo] = repoFullName.split('/');
    const rawFiles = await fetchPrDiff(owner, repo, prNumber, installationId);
    const files = preprocessDiff(rawFiles);
    const stats = calculateDiffStats(files);

    // 3. Supervisor routing decision
    const routing = await runSupervisorNode(stats, files);
    console.log(`[worker] Supervisor decision for PR #${prNumber}:`, routing);

    let styleFindings = [];
    let securityFindings = [];

    // Create AgentRun records in Prisma
    const styleRun = reviewId ? await prisma.agentRun.create({
      data: { reviewId, agentType: 'STYLE', status: 'RUNNING', startedAt: new Date() },
    }).catch(() => null) : null;

    const securityRun = reviewId ? await prisma.agentRun.create({
      data: { reviewId, agentType: 'SECURITY', status: 'RUNNING', startedAt: new Date() },
    }).catch(() => null) : null;

    if (routing.route === 'SKIP') {
      emitAgentStatus(reviewId, { agent: 'supervisor', status: 'done', message: 'No code changes to analyze' });
      if (reviewId) {
        await prisma.prReview.update({
          where: { id: reviewId },
          data: { status: 'COMPLETED', summary: routing.reason, severityScore: 0 },
        });
      }
      return;
    }

    // 4. Run agents in parallel
    emitAgentStatus(reviewId, { agent: 'style', status: 'running', message: 'Checking style conventions' });
    emitAgentStatus(reviewId, { agent: 'security', status: 'running', message: 'Auditing security vulnerabilities' });

    const agentPromises = [];

    if (routing.route === 'STYLE_ONLY' || routing.route === 'STYLE_AND_SECURITY') {
      agentPromises.push(
        runStyleAgent(files).then(async (findings) => {
          styleFindings = findings;
          emitAgentStatus(reviewId, { agent: 'style', status: 'done', findingsCount: findings.length });
          if (styleRun) {
            await prisma.agentRun.update({
              where: { id: styleRun.id },
              data: { status: 'COMPLETED', findingsJson: findings, completedAt: new Date() },
            });
          }
        })
      );
    }

    if (routing.route === 'STYLE_AND_SECURITY') {
      agentPromises.push(
        runSecurityAgent(files).then(async (findings) => {
          securityFindings = findings;
          emitAgentStatus(reviewId, { agent: 'security', status: 'done', findingsCount: findings.length });
          if (securityRun) {
            await prisma.agentRun.update({
              where: { id: securityRun.id },
              data: { status: 'COMPLETED', findingsJson: findings, completedAt: new Date() },
            });
          }
        })
      );
    }

    await Promise.all(agentPromises);

    // 5. Aggregate results & calculate severity score
    const severityScore = calculateSeverityScore(styleFindings, securityFindings);
    const markdownComment = formatMarkdownComment(severityScore, styleFindings, securityFindings);

    // 6. Post GitHub comment
    if (owner && repo && prNumber) {
      await postPrComment(owner, repo, prNumber, installationId, markdownComment);
    }

    // 7. Update PrReview record in Prisma
    if (reviewId) {
      await prisma.prReview.update({
        where: { id: reviewId },
        data: {
          status: 'COMPLETED',
          severityScore,
          summary: `Style issues: ${styleFindings.length}, Security issues: ${securityFindings.length}`,
        },
      });
    }

    emitAgentStatus(reviewId, { agent: 'supervisor', status: 'completed', severityScore });
    console.log(`[worker] Completed PR #${prNumber} review. Severity Score: ${severityScore}/10`);
  },
  { connection, concurrency: 5 }
);

reviewWorker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed successfully`);
});

reviewWorker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

module.exports = reviewWorker;
