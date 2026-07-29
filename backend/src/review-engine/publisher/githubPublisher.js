import { getAppOctokit } from '../../services/github.service.js';
import prisma from '../../config/db.js';
import { logger } from '../../shared/logger.js';

export const publishReviewResults = async ({
  pullRequestId,
  reviewAttemptId,
  installationId,
  repoFullName,
  prNumber,
  headSha,
  verifiedFindings = [],
  metrics,
  policyResult,
  delta = {},
}) => {
  if (!installationId || !repoFullName || !prNumber) {
    logger.warn('Skipping GitHub publishing: missing credentials or identifiers');
    return;
  }

  const octokit = await getAppOctokit(installationId);
  const [owner, repo] = repoFullName.split('/');

  // 1. Update/Create Check Run
  let checkRunConclusion = 'success';
  if (policyResult?.decision === 'ACTION_REQUIRED') checkRunConclusion = 'action_required';
  else if (policyResult?.decision === 'WARNING') checkRunConclusion = 'neutral';
  else if (policyResult?.decision === 'INCOMPLETE') checkRunConclusion = 'neutral';

  try {
    const pullRequest = await prisma.pullRequest.findUnique({ where: { id: pullRequestId } });

    if (pullRequest?.githubCheckRunId) {
      await octokit.rest.checks.update({
        owner,
        repo,
        check_run_id: Number(pullRequest.githubCheckRunId),
        status: 'completed',
        conclusion: checkRunConclusion,
        output: {
          title: `Codezy Review — ${policyResult?.decision || 'COMPLETED'}`,
          summary: `Risk Score: ${metrics.riskScore}/10 | Verified Findings: ${verifiedFindings.length} | Blocking: ${metrics.blockingCount}`,
        },
      });
    } else {
      const checkRunRes = await octokit.rest.checks.create({
        owner,
        repo,
        name: 'Codezy Review',
        head_sha: headSha,
        status: 'completed',
        conclusion: checkRunConclusion,
        output: {
          title: `Codezy Review — ${policyResult?.decision || 'COMPLETED'}`,
          summary: `Risk Score: ${metrics.riskScore}/10 | Verified Findings: ${verifiedFindings.length} | Blocking: ${metrics.blockingCount}`,
        },
      });

      if (pullRequestId && checkRunRes.data.id) {
        await prisma.pullRequest.update({
          where: { id: pullRequestId },
          data: { githubCheckRunId: BigInt(checkRunRes.data.id) },
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.error('Failed to publish Check Run', { error: err.message });
  }

  // 2. Persistent Summary Comment
  try {
    const summaryMarker = `<!-- codezy-summary:${pullRequestId} -->`;
    const summaryBody = `${summaryMarker}
## Codezy Level 2 Review — ${policyResult?.decision || 'PASS'}

**Risk Score:** ${metrics.riskScore}/10 | **Quality Score:** ${metrics.qualityScore}/100
**Review Confidence:** ${metrics.reviewConfidence}% | **Coverage:** ${metrics.reviewCoverage}%

### Findings Delta
- 🟢 **New:** ${delta.newFindingIds?.length || 0}
- 🟡 **Remaining:** ${delta.remainingFindingIds?.length || 0}
- 🧹 **Resolved:** ${delta.resolvedFindingIds?.length || 0}
- 🔄 **Reopened:** ${delta.reopenedFindingIds?.length || 0}

### Key Verified Findings
${verifiedFindings.length === 0 ? '_No issues detected! Great job!_' : verifiedFindings.map(f => `- **[${f.severity}]** ${f.title} (${f.filePath}:L${f.startLine}) — _Status: ${f.verificationStatus}_`).join('\n')}
`;

    const pullRequest = await prisma.pullRequest.findUnique({ where: { id: pullRequestId } });

    if (pullRequest?.githubSummaryCommentId) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: Number(pullRequest.githubSummaryCommentId),
        body: summaryBody,
      });
    } else {
      // Find existing comment with marker first
      const comments = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber });
      const existing = comments.data.find(c => c.body.includes(`codezy-summary:${pullRequestId}`));

      if (existing) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existing.id,
          body: summaryBody,
        });
        await prisma.pullRequest.update({
          where: { id: pullRequestId },
          data: { githubSummaryCommentId: BigInt(existing.id) },
        }).catch(() => {});
      } else {
        const created = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: summaryBody,
        });
        await prisma.pullRequest.update({
          where: { id: pullRequestId },
          data: { githubSummaryCommentId: BigInt(created.id) },
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.error('Failed to publish persistent summary comment', { error: err.message });
  }
};
