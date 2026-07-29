import prisma from '../../config/db.js';
import { logger } from '../../shared/logger.js';

/**
 * Computes finding lifecycle transitions across PR review attempts.
 */
export const matchFindingLifecycle = async ({
  pullRequestId,
  reviewAttemptId,
  verifiedFindings = [],
}) => {
  if (!pullRequestId) {
    return {
      lifecycleResults: verifiedFindings.map(f => ({ ...f, currentStatus: 'NEW' })),
      delta: { newFindingIds: [], remainingFindingIds: [], resolvedFindingIds: [], reopenedFindingIds: [] },
    };
  }

  try {
    // 1. Fetch previous findings for this PR from DB
    const existingFindings = await prisma.finding.findMany({
      where: { pullRequestId },
      include: { occurrences: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    const existingMap = new Map(existingFindings.map(f => [f.fingerprint, f]));
    const currentFingerprints = new Set(verifiedFindings.map(f => f.fingerprint));

    const newFindingIds = [];
    const remainingFindingIds = [];
    const resolvedFindingIds = [];
    const reopenedFindingIds = [];

    const processedFindings = [];

    // 2. Process current findings
    for (const current of verifiedFindings) {
      const existing = existingMap.get(current.fingerprint);

      let status = 'NEW';
      let findingId = existing ? existing.id : null;

      if (!existing) {
        status = 'NEW';
        // Create new Finding record
        const created = await prisma.finding.create({
          data: {
            pullRequestId,
            fingerprint: current.fingerprint,
            category: current.category,
            ruleId: current.ruleId || null,
            title: current.title,
            currentSeverity: current.severity,
            currentStatus: 'NEW',
            firstSeenAttemptId: reviewAttemptId,
            lastSeenAttemptId: reviewAttemptId,
          },
        });
        findingId = created.id;
        newFindingIds.push(findingId);
      } else {
        if (existing.currentStatus === 'RESOLVED') {
          status = 'REOPENED';
          reopenedFindingIds.push(existing.id);
        } else if (existing.currentStatus === 'DISMISSED') {
          status = 'DISMISSED'; // Preserve manual user action
        } else if (existing.currentStatus === 'ACCEPTED_RISK') {
          status = 'ACCEPTED_RISK';
        } else {
          status = 'OPEN';
          remainingFindingIds.push(existing.id);
        }

        await prisma.finding.update({
          where: { id: existing.id },
          data: {
            currentSeverity: current.severity,
            currentStatus: status,
            lastSeenAttemptId: reviewAttemptId,
          },
        });
      }

      // 3. Create FindingOccurrence record for this review attempt
      await prisma.findingOccurrence.upsert({
        where: {
          findingId_reviewAttemptId: {
            findingId,
            reviewAttemptId,
          },
        },
        update: {
          filePath: current.filePath,
          startLine: current.startLine,
          endLine: current.endLine,
          side: current.side || 'RIGHT',
          codeAnchor: current.codeAnchor,
          description: current.description,
          impact: current.impact,
          recommendation: current.recommendation || null,
          severity: current.severity,
          confidence: current.adjustedConfidence || current.confidence || 0.8,
          verificationStatus: current.verificationStatus || 'VERIFIED',
          introducedByPr: current.introducedByPr ?? true,
          blocking: current.blockingEligible ?? false,
          evidenceJson: current.evidence || {},
          sourceAgents: current.sourceAgents || [current.sourceAgent],
        },
        create: {
          findingId,
          reviewAttemptId,
          filePath: current.filePath,
          startLine: current.startLine,
          endLine: current.endLine,
          side: current.side || 'RIGHT',
          codeAnchor: current.codeAnchor,
          description: current.description,
          impact: current.impact,
          recommendation: current.recommendation || null,
          severity: current.severity,
          confidence: current.adjustedConfidence || current.confidence || 0.8,
          verificationStatus: current.verificationStatus || 'VERIFIED',
          introducedByPr: current.introducedByPr ?? true,
          blocking: current.blockingEligible ?? false,
          evidenceJson: current.evidence || {},
          sourceAgents: current.sourceAgents || [current.sourceAgent],
        },
      });

      processedFindings.push({
        ...current,
        findingId,
        currentStatus: status,
      });
    }

    // 4. Mark findings missing from current attempt as RESOLVED
    for (const existing of existingFindings) {
      if (!currentFingerprints.has(existing.fingerprint) && existing.currentStatus !== 'RESOLVED') {
        await prisma.finding.update({
          where: { id: existing.id },
          data: {
            currentStatus: 'RESOLVED',
            resolvedAttemptId: reviewAttemptId,
          },
        });
        resolvedFindingIds.push(existing.id);
      }
    }

    const delta = {
      newFindingIds,
      remainingFindingIds,
      resolvedFindingIds,
      reopenedFindingIds,
    };

    logger.info('Finding lifecycle matched', {
      pullRequestId,
      reviewAttemptId,
      new: newFindingIds.length,
      remaining: remainingFindingIds.length,
      resolved: resolvedFindingIds.length,
      reopened: reopenedFindingIds.length,
    });

    return {
      lifecycleResults: processedFindings,
      delta,
    };
  } catch (err) {
    logger.error('Error matching finding lifecycle', { error: err.message });
    return {
      lifecycleResults: verifiedFindings.map(f => ({ ...f, currentStatus: 'NEW' })),
      delta: { newFindingIds: [], remainingFindingIds: [], resolvedFindingIds: [], reopenedFindingIds: [] },
    };
  }
};
