const { Worker } = require('bullmq');
const connection = require('./connection');
const { QUEUE_NAME } = require('./reviewQueue');
const prisma = require('../config/db');
const { emitAgentStatus } = require('../config/socket');
const { fetchPrDiff, postPrComment, createCheckRun, updateCheckRun } = require('../services/github.service');
const { preprocessDiff, calculateDiffStats } = require('../services/diffPreprocessor');
const { fetchRepoConfig, getEnabledCategories } = require('../services/repoConfig.service');
const {
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
} = require('../agents/reviewAgents');

// ────────────────────────────────────────────────────────────
// Helper: Create an AgentRun record in Prisma
// ────────────────────────────────────────────────────────────
async function createAgentRun(reviewId, agentType) {
  if (!reviewId) return null;
  return prisma.agentRun.create({
    data: { reviewId, agentType, status: 'RUNNING', startedAt: new Date() },
  }).catch((err) => {
    console.error(`[Worker] Failed to create AgentRun for ${agentType}:`, err.message);
    return null;
  });
}

// Helper: Update an AgentRun with findings
async function completeAgentRun(run, findings) {
  if (!run) return;
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', findingsJson: findings, completedAt: new Date() },
  }).catch((err) => console.error(`[Worker] Failed to update AgentRun ${run.id}:`, err.message));
}

// ────────────────────────────────────────────────────────────
// Demo diff fallback (when GitHub API returns no files)
// ────────────────────────────────────────────────────────────
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
  {
    filename: 'backend/src/routes/users.js',
    status: 'added',
    additions: 20,
    deletions: 0,
    changes: 20,
    patch: `@@ -0,0 +1,20 @@
+const express = require('express');
+const router = express.Router();
+const db = require('../config/db');
+
+// Get user by ID — no auth check!
+router.get('/users/:id', async (req, res) => {
+  const userId = req.params.id;
+  // N+1 problem: this runs in a loop elsewhere
+  const user = await db.query('SELECT * FROM users WHERE id = ' + userId);
+  res.json(user);
+});
+
+router.post('/users', async (req, res) => {
+  const { name, email } = req.body;
+  // No input validation
+  const user = await db.create({ name, email });
+  res.json(user);
+});
+
+module.exports = router;`,
  },
];

// ────────────────────────────────────────────────────────────
// MAIN WORKER
// ────────────────────────────────────────────────────────────
const reviewWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { reviewId, repoFullName, prNumber, installationId, headSha, reviewCount = 1 } = job.data;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚙️  [Worker Start] PR #${prNumber} for ${repoFullName} (Review: ${reviewId})`);
    console.log(`${'═'.repeat(60)}`);

    const [owner, repo] = repoFullName.split('/');

    // ── Step 1: Create GitHub Check Run ──────────────────────
    let checkRun = null;
    if (owner && repo && headSha) {
      checkRun = await createCheckRun(owner, repo, headSha, installationId);
    }

    // ── Step 2: Mark DB review as RUNNING ────────────────────
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

    // ── Step 3: Fetch & Preprocess PR diff ───────────────────
    let rawFiles = await fetchPrDiff(owner, repo, prNumber, installationId);
    let files = preprocessDiff(rawFiles);

    if (files.length === 0) {
      console.log('💡 [Worker] No files from GitHub — using demo diff for evaluation');
      files = preprocessDiff(DEMO_FILES);
    }

    const stats = calculateDiffStats(files);
    console.log(`📊 [Diff Stats] Files: ${stats.totalFiles}, Lines: ${stats.totalLinesChanged}`);
    console.log(`📂 [File Types]`, stats.fileCategories);

    // ── Step 3.5: Fetch .codezy.yaml repo config ────────────────────
    // Determines which agent categories are enabled for this repo.
    // Falls back to all-enabled if file not found or invalid.
    const repoConfig = await fetchRepoConfig(owner, repo, installationId);
    const enabledCategories = getEnabledCategories(repoConfig);
    console.log(`⚙️  [RepoConfig] Enabled categories: [${[...enabledCategories].join(', ')}]`);

    // ── Step 4: Supervisor routing ────────────────────────────
    const routing = await runSupervisorNode(stats, files);
    console.log(`🧠 [Supervisor] Route: ${routing.route}${routing.reason ? ' — ' + routing.reason : ''}`);

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

    // ── Step 5: Run agents in parallel ───────────────────────
    // Git Hygiene is always run (static, fast, no LLM cost)
    // Other agents depend on routing

    const findingsByCategory = {
      GIT_HYGIENE: [],
      SECURITY: [],
      LOGIC: [],
      PERFORMANCE: [],
      TESTING: [],
      STYLE: [],
    };

    const agentPromises = [];

    // ── GIT HYGIENE (always runs unless explicitly disabled) ──
    if (enabledCategories.has('GIT_HYGIENE')) {
      const gitHygieneRun = await createAgentRun(reviewId, 'GIT_HYGIENE');
      emitAgentStatus(reviewId, {
        agent: 'git_hygiene',
        status: 'running',
        message: 'Static analysis: checking secrets, sensitive files, debug artifacts...',
      });
      agentPromises.push(
        runGitHygieneAgent(files, stats).then(async (findings) => {
          findingsByCategory.GIT_HYGIENE = findings;
          console.log(`🔑 [GitHygieneAgent] ${findings.length} issues found`);
          emitAgentStatus(reviewId, {
            agent: 'git_hygiene',
            status: 'done',
            findingsCount: findings.length,
            message: `${findings.length} git hygiene issue(s) found`,
          });
          await completeAgentRun(gitHygieneRun, findings);
        })
      );
    } else {
      console.log('⏭️ [RepoConfig] GIT_HYGIENE disabled — skipping agent');
    }

    // ── STYLE (runs unless GIT_HYGIENE_ONLY or disabled) ──
    if (routing.route !== 'GIT_HYGIENE_ONLY' && enabledCategories.has('STYLE')) {
      const styleRun = await createAgentRun(reviewId, 'STYLE');
      emitAgentStatus(reviewId, {
        agent: 'style',
        status: 'running',
        message: 'Reviewing code style, naming, and quality conventions...',
      });
      agentPromises.push(
        runStyleAgent(files, stats.totalLinesChanged).then(async (findings) => {
          findingsByCategory.STYLE = findings;
          console.log(`🎨 [StyleAgent] ${findings.length} issues found`);
          emitAgentStatus(reviewId, {
            agent: 'style',
            status: 'done',
            findingsCount: findings.length,
          });
          await completeAgentRun(styleRun, findings);
        })
      );
    } else if (routing.route !== 'GIT_HYGIENE_ONLY') {
      console.log('⏭️ [RepoConfig] STYLE disabled — skipping agent');
    }

    if (routing.route !== 'GIT_HYGIENE_ONLY' && enabledCategories.has('SECURITY')) {
      // ── SECURITY ──
      const securityRun = await createAgentRun(reviewId, 'SECURITY');
      emitAgentStatus(reviewId, {
        agent: 'security',
        status: 'running',
        message: 'Auditing for SQL injection, XSS, auth gaps, and injection vulnerabilities...',
      });
      agentPromises.push(
        runSecurityAgent(files, stats.totalLinesChanged).then(async (findings) => {
          findingsByCategory.SECURITY = findings;
          console.log(`🔒 [SecurityAgent] ${findings.length} issues found`);
          emitAgentStatus(reviewId, {
            agent: 'security',
            status: 'done',
            findingsCount: findings.length,
          });
          await completeAgentRun(securityRun, findings);
        })
      );
    } else if (routing.route !== 'GIT_HYGIENE_ONLY') {
      console.log('⏭️ [RepoConfig] SECURITY disabled — skipping agent');
    }

    // ── FULL_REVIEW only agents ──
    if (routing.route === 'FULL_REVIEW') {
      if (enabledCategories.has('LOGIC')) {
        const logicRun = await createAgentRun(reviewId, 'LOGIC');
        emitAgentStatus(reviewId, {
          agent: 'logic',
          status: 'running',
          message: 'Checking null handling, async safety, edge cases, operator correctness...',
        });
        agentPromises.push(
          runLogicAgent(files, stats.totalLinesChanged).then(async (findings) => {
            findingsByCategory.LOGIC = findings;
            console.log(`🧠 [LogicAgent] ${findings.length} issues found`);
            emitAgentStatus(reviewId, {
              agent: 'logic',
              status: 'done',
              findingsCount: findings.length,
            });
            await completeAgentRun(logicRun, findings);
          })
        );
      } else {
        console.log('⏭️ [RepoConfig] LOGIC disabled — skipping agent');
      }

      if (enabledCategories.has('PERFORMANCE')) {
        const performanceRun = await createAgentRun(reviewId, 'PERFORMANCE');
        emitAgentStatus(reviewId, {
          agent: 'performance',
          status: 'running',
          message: 'Detecting N+1 queries, memory leaks, blocking operations...',
        });
        agentPromises.push(
          runPerformanceAgent(files, stats.totalLinesChanged).then(async (findings) => {
            findingsByCategory.PERFORMANCE = findings;
            console.log(`⚡ [PerformanceAgent] ${findings.length} issues found`);
            emitAgentStatus(reviewId, {
              agent: 'performance',
              status: 'done',
              findingsCount: findings.length,
            });
            await completeAgentRun(performanceRun, findings);
          })
        );
      } else {
        console.log('⏭️ [RepoConfig] PERFORMANCE disabled — skipping agent');
      }

      if (enabledCategories.has('TESTING')) {
        const testingRun = await createAgentRun(reviewId, 'TESTING');
        emitAgentStatus(reviewId, {
          agent: 'testing',
          status: 'running',
          message: 'Checking for missing test coverage on new code...',
        });
        agentPromises.push(
          runTestingAgent(files, stats.totalLinesChanged).then(async (findings) => {
            findingsByCategory.TESTING = findings;
            console.log(`🧪 [TestingAgent] ${findings.length} issues found`);
            emitAgentStatus(reviewId, {
              agent: 'testing',
              status: 'done',
              findingsCount: findings.length,
            });
            await completeAgentRun(testingRun, findings);
          })
        );
      } else {
        console.log('⏭️ [RepoConfig] TESTING disabled — skipping agent');
      }
    }

    // Wait for all agents to complete in parallel
    await Promise.all(agentPromises);

    console.log(`\n📋 [Pre-Judge Summary]:`);
    Object.entries(findingsByCategory).forEach(([cat, arr]) => {
      if (arr.length > 0) console.log(`   ${cat}: ${arr.length} findings`);
    });

    // ── Step 6: Judge / Verification Pass ────────────────────
    // Flatten all findings for judge
    const allFindingsFlat = Object.values(findingsByCategory).flat();
    const totalBeforeJudge = allFindingsFlat.length;

    emitAgentStatus(reviewId, {
      agent: 'judge',
      status: 'running',
      message: `Verifying ${totalBeforeJudge} findings against diff — filtering false positives...`,
    });

    const judgeRun = await createAgentRun(reviewId, 'JUDGE');
    let verifiedFindings = await runJudgeAgent(allFindingsFlat, files, stats.totalLinesChanged);

    // Rebuild findingsByCategory from verified findings
    const verifiedByCategory = {
      GIT_HYGIENE: [],
      SECURITY: [],
      LOGIC: [],
      PERFORMANCE: [],
      TESTING: [],
      STYLE: [],
    };
    verifiedFindings.forEach((f) => {
      const cat = f.category || 'STYLE';
      if (verifiedByCategory[cat]) {
        verifiedByCategory[cat].push(f);
      } else {
        verifiedByCategory.STYLE.push(f);
      }
    });

    const totalAfterJudge = verifiedFindings.length;
    const filtered = totalBeforeJudge - totalAfterJudge;

    console.log(`⚖️  [JudgeAgent] Verified ${totalAfterJudge}/${totalBeforeJudge} findings (filtered ${filtered} false positives)`);
    emitAgentStatus(reviewId, {
      agent: 'judge',
      status: 'done',
      message: `Verified ${totalAfterJudge} findings, removed ${filtered} false positive(s)`,
      findingsCount: totalAfterJudge,
    });
    await completeAgentRun(judgeRun, verifiedFindings);

    // ── Step 7: Calculate explicit severity score (with path weighting) ──────
    const severityScore = calculateSeverityScore(verifiedByCategory, files);
    console.log(`📈 [Severity Score] ${severityScore}/10`);

    // Agent summary for DB storage
    const agentSummary = {};
    Object.entries(verifiedByCategory).forEach(([cat, arr]) => {
      agentSummary[cat] = arr.length;
    });

    // ── Step 8: Format markdown comment ──────────────────────
    const markdownComment = formatMarkdownComment(
      severityScore,
      verifiedByCategory,
      agentSummary,
      { reviewCount, headSha }  // Feature 5: review counter + commit SHA in footer
    );

    // ── Step 9: Post GitHub PR comment ───────────────────────
    if (owner && repo && prNumber) {
      await postPrComment(owner, repo, prNumber, installationId, markdownComment);
    }

    // ── Step 10: Update GitHub Check Run ─────────────────────
    if (checkRun && checkRun.id) {
      await updateCheckRun(owner, repo, checkRun.id, installationId, severityScore, markdownComment);
    }

    // ── Step 11: Update PrReview in DB ───────────────────────
    if (reviewId) {
      await prisma.prReview.update({
        where: { id: reviewId },
        data: {
          status: 'COMPLETED',
          severityScore: Math.round(severityScore),
          summary: `GH:${agentSummary.GIT_HYGIENE || 0} SEC:${agentSummary.SECURITY || 0} LOG:${agentSummary.LOGIC || 0} PERF:${agentSummary.PERFORMANCE || 0} TEST:${agentSummary.TESTING || 0} STY:${agentSummary.STYLE || 0}`,
          agentSummary,
        },
      }).catch((err) => console.error('❌ [DB] Failed to complete review:', err.message));
    }

    emitAgentStatus(reviewId, {
      agent: 'supervisor',
      status: 'completed',
      severityScore,
      message: `Review complete! Score: ${severityScore}/10 | ${totalAfterJudge} verified findings`,
    });

    console.log(`✅ [Worker Complete] PR #${prNumber} reviewed. Score: ${severityScore}/10, Findings: ${totalAfterJudge}`);
    console.log(`${'═'.repeat(60)}\n`);
  },
  { connection, concurrency: 5 }
);

// ────────────────────────────────────────────────────────────
// Worker event handlers
// ────────────────────────────────────────────────────────────
reviewWorker.on('completed', (job) => {
  console.log(`[BullMQ] Job ${job.id} completed successfully`);
});

reviewWorker.on('failed', (job, err) => {
  console.error(`❌ [BullMQ] Job ${job?.id} failed:`, err.message);
  // Attempt to mark review as FAILED in DB
  const reviewId = job?.data?.reviewId;
  if (reviewId) {
    prisma.prReview.update({
      where: { id: reviewId },
      data: { status: 'FAILED' },
    }).catch(() => {});
  }
});

module.exports = reviewWorker;
