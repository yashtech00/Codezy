import { Worker } from 'bullmq';
import connection from './connection.js';
import { QUEUE_NAME } from './reviewQueue.js';
import prisma from '../config/db.js';
import { emitAgentStatus } from '../config/socket.js';
import { fetchPrDiff, postPrComment, createCheckRun, updateCheckRun } from '../services/github.service.js';
import { preprocessDiff, calculateDiffStats } from '../services/diffPreprocessor.js';
import { fetchRepoConfig, getEnabledCategories } from '../services/repoConfig.service.js';
import {
  runSupervisorNode,
  runGitHygieneAgent,
  runStyleAgent,
  runSecurityAgent,
  runLogicAgent,
  runPerformanceAgent,
  runTestingAgent,
  runJudgeAgent,
  calculateSeverityScore,
  formatMarkdownComment,
} from '../agents/reviewAgents.js';

// Level 2 Pipeline Modules
import { deduplicateFindings } from '../review-engine/findings/deduplicate.js';
import { retrieveHunkContext } from '../review-engine/context/contextRetriever.js';
import { verifyCandidates } from '../review-engine/agents/verification/verification.agent.js';
import { matchFindingLifecycle } from '../review-engine/findings/lifecycle.js';
import { computePRMetrics } from '../review-engine/scoring/scoring.js';
import { evaluatePolicy } from '../review-engine/policies/policyEngine.js';
import { publishReviewResults } from '../review-engine/publisher/githubPublisher.js';
import { logger } from '../shared/logger.js';

async function createAgentRun(reviewId, agentType) {
  if (!reviewId) return null;
  return prisma.agentRun.create({
    data: { reviewId, agentType, status: 'RUNNING', startedAt: new Date() },
  }).catch((err) => {
    console.error(`[Worker] Failed to create AgentRun for ${agentType}:`, err.message);
    return null;
  });
}

async function completeAgentRun(run, findings) {
  if (!run) return;
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', findingsJson: findings, completedAt: new Date() },
  }).catch((err) => console.error(`[Worker] Failed to update AgentRun ${run.id}:`, err.message));
}

const DEMO_FILES = [
  {
    filename: 'backend/src/test-demo.js',
    status: 'modified',
    additions: 14,
    deletions: 2,
    changes: 16,
    patch: `@@ -1,6 +1,8 @@
+const API_KEY = "AIzaSyDummySecretKey123456789";
+const DB_PASSWORD = "super_secret_123";
 function calculate_total( price , tax ){
   var total = price + tax
+  console.log("total:", total)
+  if (total == null) {
+    return 0;
+  }
   return eval("total")
 }
-module.exports = { calculate_total };
+export default { calculate_total };`,
  },
];

const reviewWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { reviewId, repoFullName, prNumber, installationId, headSha, reviewCount = 1 } = job.data;

    logger.info('Review Job Started', { prNumber, repoFullName, reviewId, headSha });

    const [owner, repo] = repoFullName.split('/');

    let checkRun = null;
    if (owner && repo && headSha) {
      checkRun = await createCheckRun(owner, repo, headSha, installationId);
    }

    if (reviewId) {
      await prisma.prReview.update({
        where: { id: reviewId },
        data: { status: 'RUNNING' },
      }).catch((err) => console.error('❌ [DB] Failed to set RUNNING:', err.message));
    }

    emitAgentStatus(reviewId, {
      agent: 'supervisor',
      status: 'running',
      message: 'Analyzing PR diff — routing to review agents...',
    });

    let rawFiles = await fetchPrDiff(owner, repo, prNumber, installationId);
    let files = preprocessDiff(rawFiles);

    if (files.length === 0) {
      files = preprocessDiff(DEMO_FILES);
    }

    const stats = calculateDiffStats(files);
    const repoConfig = await fetchRepoConfig(owner, repo, installationId);
    const enabledCategories = getEnabledCategories(repoConfig);

    const routing = await runSupervisorNode(stats, files);

    emitAgentStatus(reviewId, {
      agent: 'supervisor',
      status: 'done',
      message: `Routing: ${routing.route} | ${stats.totalLinesChanged} lines changed across ${stats.totalFiles} files`,
    });

    if (routing.route === 'SKIP') {
      const skipComment = `## 🤖 Codezy AI Review\n\n✅ **No code changes detected — only documentation/config files changed.**\n\n*Automated review by Codezy Multi-Agent Engine.*`;
      if (owner && repo && prNumber) {
        await postPrComment(owner, repo, prNumber, installationId, skipComment);
      }
      if (reviewId) {
        await prisma.prReview.update({
          where: { id: reviewId },
          data: { status: 'COMPLETED', severityScore: 0, summary: 'Skipped: docs/config only' },
        });
      }
      emitAgentStatus(reviewId, { agent: 'supervisor', status: 'completed', severityScore: 0 });
      return;
    }

    const rawCandidates = [];
    const agentPromises = [];

    // Run Git Hygiene Agent
    if (enabledCategories.has('GIT_HYGIENE')) {
      const gitHygieneRun = await createAgentRun(reviewId, 'GIT_HYGIENE');
      agentPromises.push(
        runGitHygieneAgent(files, stats).then(async (findings) => {
          rawCandidates.push(
            ...findings.map(f => ({
              source: 'STATIC',
              sourceAgent: 'git_hygiene',
              category: 'GIT_HYGIENE',
              title: f.title || f.rule || 'Git Hygiene Issue',
              description: f.description || f.message || '',
              filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
              startLine: f.line || f.startLine || 1,
              endLine: f.line || f.endLine || 1,
              side: 'RIGHT',
              severity: (f.severity || 'MEDIUM').toUpperCase(),
              confidence: 0.95,
              evidence: { changedCode: f.snippet || '', reasoning: f.explanation || '' },
              impact: f.impact || 'Git hygiene policy violation',
              recommendation: f.recommendation || f.suggestion || null,
            }))
          );
          await completeAgentRun(gitHygieneRun, findings);
        })
      );
    }

    // Run Security Agent
    if (routing.route !== 'GIT_HYGIENE_ONLY' && enabledCategories.has('SECURITY')) {
      const securityRun = await createAgentRun(reviewId, 'SECURITY');
      agentPromises.push(
        runSecurityAgent(files, stats.totalLinesChanged).then(async (findings) => {
          rawCandidates.push(
            ...findings.map(f => ({
              source: 'AI',
              sourceAgent: 'security',
              category: 'SECURITY',
              title: f.title || 'Security Vulnerability',
              description: f.description || f.reasoning || '',
              filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
              startLine: f.line || f.startLine || 1,
              endLine: f.line || f.endLine || 1,
              side: 'RIGHT',
              severity: (f.severity || 'HIGH').toUpperCase(),
              confidence: 0.85,
              evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || '' },
              impact: f.impact || 'Security risk detected',
              recommendation: f.recommendation || f.suggestion || null,
            }))
          );
          await completeAgentRun(securityRun, findings);
        })
      );
    }

    // Run Style Agent
    if (routing.route !== 'GIT_HYGIENE_ONLY' && enabledCategories.has('STYLE')) {
      const styleRun = await createAgentRun(reviewId, 'STYLE');
      agentPromises.push(
        runStyleAgent(files, stats.totalLinesChanged).then(async (findings) => {
          rawCandidates.push(
            ...findings.map(f => ({
              source: 'AI',
              sourceAgent: 'style',
              category: 'STYLE',
              title: f.title || 'Style Violation',
              description: f.description || f.reasoning || '',
              filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
              startLine: f.line || f.startLine || 1,
              endLine: f.line || f.endLine || 1,
              side: 'RIGHT',
              severity: (f.severity || 'LOW').toUpperCase(),
              confidence: 0.75,
              evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || '' },
              impact: f.impact || 'Code style inconsistency',
              recommendation: f.recommendation || f.suggestion || null,
            }))
          );
          await completeAgentRun(styleRun, findings);
        })
      );
    }

    // Run Logic Agent
    if (routing.route === 'FULL_REVIEW' && enabledCategories.has('LOGIC')) {
      const logicRun = await createAgentRun(reviewId, 'LOGIC');
      agentPromises.push(
        runLogicAgent(files, stats.totalLinesChanged).then(async (findings) => {
          rawCandidates.push(
            ...findings.map(f => ({
              source: 'AI',
              sourceAgent: 'logic',
              category: 'LOGIC',
              title: f.title || 'Logic Defect',
              description: f.description || f.reasoning || '',
              filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
              startLine: f.line || f.startLine || 1,
              endLine: f.line || f.endLine || 1,
              side: 'RIGHT',
              severity: (f.severity || 'HIGH').toUpperCase(),
              confidence: 0.85,
              evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || '' },
              impact: f.impact || 'Potential runtime or logic bug',
              recommendation: f.recommendation || f.suggestion || null,
            }))
          );
          await completeAgentRun(logicRun, findings);
        })
      );
    }

    // Run Performance Agent
    if (routing.route === 'FULL_REVIEW' && enabledCategories.has('PERFORMANCE')) {
      const performanceRun = await createAgentRun(reviewId, 'PERFORMANCE');
      agentPromises.push(
        runPerformanceAgent(files, stats.totalLinesChanged).then(async (findings) => {
          rawCandidates.push(
            ...findings.map(f => ({
              source: 'AI',
              sourceAgent: 'performance',
              category: 'PERFORMANCE',
              title: f.title || 'Performance Issue',
              description: f.description || f.reasoning || '',
              filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
              startLine: f.line || f.startLine || 1,
              endLine: f.line || f.endLine || 1,
              side: 'RIGHT',
              severity: (f.severity || 'MEDIUM').toUpperCase(),
              confidence: 0.8,
              evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || '' },
              impact: f.impact || 'Performance bottleneck',
              recommendation: f.recommendation || f.suggestion || null,
            }))
          );
          await completeAgentRun(performanceRun, findings);
        })
      );
    }

    // Run Testing Agent
    if (routing.route === 'FULL_REVIEW' && enabledCategories.has('TESTING')) {
      const testingRun = await createAgentRun(reviewId, 'TESTING');
      agentPromises.push(
        runTestingAgent(files, stats.totalLinesChanged).then(async (findings) => {
          rawCandidates.push(
            ...findings.map(f => ({
              source: 'AI',
              sourceAgent: 'testing',
              category: 'TESTING',
              title: f.title || 'Missing Tests',
              description: f.description || f.reasoning || '',
              filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
              startLine: f.line || f.startLine || 1,
              endLine: f.line || f.endLine || 1,
              side: 'RIGHT',
              severity: (f.severity || 'MEDIUM').toUpperCase(),
              confidence: 0.8,
              evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || '' },
              impact: f.impact || 'Untested code branch',
              recommendation: f.recommendation || f.suggestion || null,
            }))
          );
          await completeAgentRun(testingRun, findings);
        })
      );
    }

    await Promise.all(agentPromises);

    // ── LEVEL 2 PIPELINE EXECUTION ────────────────────────────

    // 1. Context Retrieval
    const repoContext = await retrieveHunkContext({ changedFiles: files });

    // 2. Deduplication
    const repoRecord = await prisma.repository.findFirst({ where: { fullName: repoFullName } });
    const repoId = repoRecord ? repoRecord.id : 'default_repo';
    const deduplicatedCandidates = deduplicateFindings(rawCandidates, repoId);

    // 3. Verification Engine
    emitAgentStatus(reviewId, {
      agent: 'verification',
      status: 'running',
      message: `Verifying ${deduplicatedCandidates.length} deduplicated finding candidate(s)...`,
    });
    const verifiedFindings = await verifyCandidates(deduplicatedCandidates, repoContext);

    // 4. Finding Lifecycle Matching
    const pullRequestRecord = await prisma.pullRequest.findFirst({
      where: { repository: { fullName: repoFullName }, githubPrNumber: prNumber },
    });
    const prId = pullRequestRecord ? pullRequestRecord.id : null;

    const reviewAttemptRecord = prId
      ? await prisma.reviewAttempt.findFirst({
          where: { pullRequestId: prId, headSha },
        })
      : null;
    const attemptId = reviewAttemptRecord ? reviewAttemptRecord.id : 'temp_attempt';

    const { lifecycleResults, delta } = await matchFindingLifecycle({
      pullRequestId: prId,
      reviewAttemptId: attemptId,
      verifiedFindings,
    });

    // 5. Scoring & Policy Engine
    const metrics = computePRMetrics(verifiedFindings, 100);
    const policyResult = evaluatePolicy({ verifiedFindings, metrics, repoConfig });

    // 6. Level 2 DB Updates
    if (reviewAttemptRecord) {
      await prisma.reviewAttempt.update({
        where: { id: reviewAttemptRecord.id },
        data: {
          status: 'COMPLETED',
          riskScore: metrics.riskScore,
          qualityScore: metrics.qualityScore,
          reviewConfidence: metrics.reviewConfidence,
          reviewCoverage: metrics.reviewCoverage,
          mergeDecision: policyResult.decision,
          reviewDelta: delta,
          policyResult,
          completedAt: new Date(),
        },
      }).catch(() => {});
    }

    // 7. GitHub Publisher
    await publishReviewResults({
      pullRequestId: prId,
      reviewAttemptId: attemptId,
      installationId,
      repoFullName,
      prNumber,
      headSha,
      verifiedFindings,
      metrics,
      policyResult,
      delta,
    });

    // 8. Backward-compatible DB update for PrReview
    if (reviewId) {
      await prisma.prReview.update({
        where: { id: reviewId },
        data: {
          status: 'COMPLETED',
          severityScore: Math.round(metrics.riskScore),
          summary: `Risk:${metrics.riskScore}/10 decision:${policyResult.decision} verified:${verifiedFindings.length}`,
        },
      }).catch((err) => console.error('❌ [DB] Failed to complete review:', err.message));
    }

    emitAgentStatus(reviewId, {
      agent: 'supervisor',
      status: 'completed',
      severityScore: metrics.riskScore,
      message: `Level 2 Review complete! Decision: ${policyResult.decision} | Risk: ${metrics.riskScore}/10`,
    });

    logger.info('Level 2 Review Execution Completed', { prNumber, repoFullName, decision: policyResult.decision, riskScore: metrics.riskScore });
  },
  { connection, concurrency: 5 }
);

reviewWorker.on('completed', (job) => {
  logger.info(`BullMQ Job Completed`, { jobId: job.id });
});

reviewWorker.on('failed', (job, err) => {
  logger.error(`BullMQ Job Failed`, { jobId: job?.id, error: err.message });
  const reviewId = job?.data?.reviewId;
  if (reviewId) {
    prisma.prReview.update({
      where: { id: reviewId },
      data: { status: 'FAILED' },
    }).catch(() => {});
  }
});

export default reviewWorker;
