import { Worker } from 'bullmq';
import connection from './connection.js';
import { QUEUE_NAME } from './reviewQueue.js';
import prisma from '../config/db.js';
import { emitAgentStatus } from '../config/socket.js';
import { fetchPrDiff, postPrComment, createCheckRun } from '../services/github.service.js';
import { preprocessDiff, calculateDiffStats } from '../services/diffPreprocessor.js';
import { fetchRepoConfig, getEnabledCategories } from '../services/repoConfig.service.js';
import {
  runStyleAgent,
  runSecurityAgent,
  runLogicAgent,
  runPerformanceAgent,
  runTestingAgent,
} from '../agents/reviewAgents.js';

// Level 2 & Production Architecture Modules
import { classifyPushChanges } from '../review-engine/classification/changeClassifier.js';
import { runDeterministicScanners } from '../review-engine/detectors/deterministicScanners.js';
import { fitPatchesToBudget } from '../review-engine/context/tokenBudgetManager.js';
import { retrieveHunkContext } from '../review-engine/context/contextRetriever.js';
import { deduplicateFindings } from '../review-engine/findings/deduplicate.js';
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
      message: 'Analyzing PR diff — running classification & risk routing...',
    });

    let rawFiles = await fetchPrDiff(owner, repo, prNumber, installationId);
    let files = preprocessDiff(rawFiles);

    if (files.length === 0 && job.data.isTestTrigger) {
      files = preprocessDiff(DEMO_FILES);
    }

    if (files.length === 0) {
      logger.info('No files found in PR diff', { owner, repo, prNumber });
      const emptyComment = `## 🤖 Codezy Level 2 Review — PASS\n\n✅ **No code changes detected in this pull request.**\n\n*Automated review by Codezy Multi-Agent Engine.*`;
      
      if (owner && repo && prNumber) {
        await postPrComment(owner, repo, prNumber, installationId, emptyComment).catch(() => {});
      }

      if (reviewId) {
        await prisma.prReview.update({
          where: { id: reviewId },
          data: { status: 'COMPLETED', severityScore: 0, summary: 'No files in diff' },
        }).catch(() => {});
      }
      return;
    }

    const stats = calculateDiffStats(files);
    const repoConfig = await fetchRepoConfig(owner, repo, installationId);
    const enabledCategories = getEnabledCategories(repoConfig);

    // Step 1: Change Classification & Risk Router
    const classification = classifyPushChanges(files, stats);

    emitAgentStatus(reviewId, {
      agent: 'supervisor',
      status: 'done',
      message: `Routing: ${classification.route} | Risk: ${classification.baseRiskScore}/10 | Change Types: ${classification.changeTypes.join(', ')}`,
    });

    if (classification.route === 'SKIP') {
      const skipComment = `## 🤖 Codezy AI Review\n\n✅ **No code changes detected — only documentation files changed.**\n\n*Automated review by Codezy Multi-Agent Engine.*`;
      if (owner && repo && prNumber) {
        await postPrComment(owner, repo, prNumber, installationId, skipComment);
      }
      if (reviewId) {
        await prisma.prReview.update({
          where: { id: reviewId },
          data: { status: 'COMPLETED', severityScore: 0, summary: 'Skipped: docs only' },
        });
      }
      emitAgentStatus(reviewId, { agent: 'supervisor', status: 'completed', severityScore: 0 });
      return;
    }

    const rawCandidates = [];

    // Step 2: Run Deterministic Scanners First (0 token cost)
    const staticRun = await createAgentRun(reviewId, 'DETERMINISTIC_SCANNERS');
    const staticCandidates = runDeterministicScanners(files, stats);
    rawCandidates.push(...staticCandidates);
    await completeAgentRun(staticRun, staticCandidates);

    // Step 3: Context Retrieval & Token Budget Manager
    const repoContext = await retrieveHunkContext({ changedFiles: files, pillars: classification.pillars });
    const { formattedDiffPrompt } = fitPatchesToBudget(files);

    // Step 4: AI Multi-Pillar Review Passes
    if (classification.route !== 'DETERMINISTIC_ONLY') {
      const agentPromises = [];

      // Security & Privacy Pillar
      if (classification.pillars.includes('SECURITY_PRIVACY') && enabledCategories.has('SECURITY')) {
        const securityRun = await createAgentRun(reviewId, 'SECURITY_PRIVACY');
        agentPromises.push(
          runSecurityAgent(files, stats.totalLinesChanged).then(async (findings) => {
            rawCandidates.push(
              ...findings.map(f => ({
                source: 'AI',
                sourceAgent: 'security_agent',
                pillar: 'SECURITY_PRIVACY',
                category: 'SECURITY',
                title: f.title || 'Security Vulnerability',
                description: f.description || f.reasoning || f.issue || '',
                filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
                startLine: f.line || f.startLine || 1,
                endLine: f.line || f.endLine || 1,
                side: 'RIGHT',
                severity: (f.severity || 'HIGH').toUpperCase(),
                confidence: 0.85,
                evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || f.issue || '' },
                impact: f.impact || 'Security risk detected',
                recommendation: f.recommendation || f.suggestion || null,
                suggestedFix: f.suggestedFix || null,
              }))
            );
            await completeAgentRun(securityRun, findings);
          })
        );
      }

      // Functional Correctness / Logic Pillar
      if (classification.pillars.includes('FUNCTIONAL_CORRECTNESS') && enabledCategories.has('LOGIC')) {
        const logicRun = await createAgentRun(reviewId, 'FUNCTIONAL_CORRECTNESS');
        agentPromises.push(
          runLogicAgent(files, stats.totalLinesChanged).then(async (findings) => {
            rawCandidates.push(
              ...findings.map(f => ({
                source: 'AI',
                sourceAgent: 'logic_agent',
                pillar: 'FUNCTIONAL_CORRECTNESS',
                category: 'LOGIC',
                title: f.title || 'Functional Correctness Defect',
                description: f.description || f.reasoning || f.issue || '',
                filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
                startLine: f.line || f.startLine || 1,
                endLine: f.line || f.endLine || 1,
                side: 'RIGHT',
                severity: (f.severity || 'HIGH').toUpperCase(),
                confidence: 0.85,
                evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || f.issue || '' },
                impact: f.impact || 'Potential runtime or logic bug',
                recommendation: f.recommendation || f.suggestion || null,
                suggestedFix: f.suggestedFix || null,
              }))
            );
            await completeAgentRun(logicRun, findings);
          })
        );
      }

      // Performance Pillar
      if (classification.pillars.includes('PERFORMANCE') && enabledCategories.has('PERFORMANCE')) {
        const performanceRun = await createAgentRun(reviewId, 'PERFORMANCE');
        agentPromises.push(
          runPerformanceAgent(files, stats.totalLinesChanged).then(async (findings) => {
            rawCandidates.push(
              ...findings.map(f => ({
                source: 'AI',
                sourceAgent: 'performance_agent',
                pillar: 'PERFORMANCE',
                category: 'PERFORMANCE',
                title: f.title || 'Performance Risk',
                description: f.description || f.reasoning || f.issue || '',
                filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
                startLine: f.line || f.startLine || 1,
                endLine: f.line || f.endLine || 1,
                side: 'RIGHT',
                severity: (f.severity || 'MEDIUM').toUpperCase(),
                confidence: 0.8,
                evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || f.issue || '' },
                impact: f.impact || 'Performance bottleneck',
                recommendation: f.recommendation || f.suggestion || null,
                suggestedFix: f.suggestedFix || null,
              }))
            );
            await completeAgentRun(performanceRun, findings);
          })
        );
      }

      // Testing Pillar
      if (classification.pillars.includes('TESTING') && enabledCategories.has('TESTING')) {
        const testingRun = await createAgentRun(reviewId, 'TESTING');
        agentPromises.push(
          runTestingAgent(files, stats.totalLinesChanged).then(async (findings) => {
            rawCandidates.push(
              ...findings.map(f => ({
                source: 'AI',
                sourceAgent: 'testing_agent',
                pillar: 'TESTING',
                category: 'TESTING',
                title: f.title || 'Testing Gap',
                description: f.description || f.reasoning || f.issue || '',
                filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
                startLine: f.line || f.startLine || 1,
                endLine: f.line || f.endLine || 1,
                side: 'RIGHT',
                severity: (f.severity || 'MEDIUM').toUpperCase(),
                confidence: 0.8,
                evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || f.issue || '' },
                impact: f.impact || 'Untested behavior change',
                recommendation: f.recommendation || f.suggestion || null,
                suggestedFix: f.suggestedFix || null,
              }))
            );
            await completeAgentRun(testingRun, findings);
          })
        );
      }

      // Architecture & Style Pillar
      if (enabledCategories.has('STYLE')) {
        const styleRun = await createAgentRun(reviewId, 'ARCHITECTURE_STYLE');
        agentPromises.push(
          runStyleAgent(files, stats.totalLinesChanged).then(async (findings) => {
            rawCandidates.push(
              ...findings.map(f => ({
                source: 'AI',
                sourceAgent: 'style_agent',
                pillar: 'ARCHITECTURE',
                category: 'STYLE',
                title: f.title || 'Code Style & Conventions',
                description: f.description || f.reasoning || f.issue || '',
                filePath: f.file || f.filePath || files[0]?.filename || 'unknown',
                startLine: f.line || f.startLine || 1,
                endLine: f.line || f.endLine || 1,
                side: 'RIGHT',
                severity: (f.severity || 'LOW').toUpperCase(),
                confidence: 0.75,
                evidence: { changedCode: f.snippet || '', reasoning: f.reasoning || f.issue || '' },
                impact: f.impact || 'Code quality or maintainability issue',
                recommendation: f.recommendation || f.suggestion || null,
                suggestedFix: f.suggestedFix || null,
              }))
            );
            await completeAgentRun(styleRun, findings);
          })
        );
      }

      await Promise.all(agentPromises);
    }

    // Step 5: Deduplication Engine
    const repoRecord = await prisma.repository.findFirst({ where: { fullName: repoFullName } });
    const repoId = repoRecord ? repoRecord.id : 'default_repo';
    const deduplicatedCandidates = deduplicateFindings(rawCandidates, repoId);

    // Step 6: Selective LLM Verifier Pass
    emitAgentStatus(reviewId, {
      agent: 'verification',
      status: 'running',
      message: `Verifying ${deduplicatedCandidates.length} candidate finding(s) with verifier agent...`,
    });
    const verifiedFindings = await verifyCandidates(deduplicatedCandidates, repoContext);

    // Step 7: Finding Lifecycle Matching (Introduced by PR)
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

    // Step 8: Scoring & Policy Engine
    const metrics = computePRMetrics(verifiedFindings, 100);
    const policyResult = evaluatePolicy({ verifiedFindings, metrics, repoConfig });

    // Step 9: DB Updates
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

    // Step 10: GitHub Publisher
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
      existingCheckRunId: checkRun?.id ? Number(checkRun.id) : null,
    });

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
      message: `Production Review Complete! Decision: ${policyResult.decision} | Risk: ${metrics.riskScore}/10`,
    });

    logger.info('Review Execution Completed', { prNumber, repoFullName, decision: policyResult.decision, riskScore: metrics.riskScore });
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
