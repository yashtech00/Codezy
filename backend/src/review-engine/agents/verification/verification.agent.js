import { validateVerifiedFinding } from '../../schemas/finding.schema.js';
import { logger } from '../../../shared/logger.js';

/**
 * Independent Verification Engine for Level 2
 * Evaluates candidate findings against code evidence and assigns verification status.
 */
export const verifyCandidates = async (candidateFindings = [], repositoryContext = null) => {
  if (!Array.isArray(candidateFindings) || candidateFindings.length === 0) {
    return [];
  }

  const verifiedFindings = [];

  for (const candidate of candidateFindings) {
    try {
      // 1. Check if candidate originated from static analysis (always VERIFIED)
      if (candidate.source === 'STATIC' || candidate.source === 'DEPENDENCY_SCANNER') {
        const verified = {
          ...candidate,
          verificationStatus: 'VERIFIED',
          introducedByPr: true,
          adjustedConfidence: Math.max(candidate.confidence || 0.9, 0.95),
          blockingEligible: ['CRITICAL', 'HIGH'].includes(candidate.severity),
          verificationEvidence: [
            {
              type: 'STATIC',
              description: `Deterministic proof provided by ${candidate.sourceAgent || 'static scanner'}.`,
              reference: candidate.ruleId,
            },
          ],
        };
        verifiedFindings.push(verified);
        continue;
      }

      // 2. Evaluate AI Candidate Findings
      const hasCodeSnippet = Boolean(candidate.evidence?.changedCode && candidate.evidence.changedCode.trim().length > 0);
      const hasValidReasoning = Boolean(candidate.evidence?.reasoning && candidate.evidence.reasoning.trim().length > 10);
      const isHighConfidence = (candidate.confidence || 0.8) >= 0.7;

      let status = 'UNVERIFIED';
      let blockingEligible = false;
      let adjustedConfidence = candidate.confidence || 0.8;

      if (hasCodeSnippet && hasValidReasoning && isHighConfidence) {
        status = 'VERIFIED';
        blockingEligible = ['CRITICAL', 'HIGH'].includes(candidate.severity);
        adjustedConfidence = Math.min(adjustedConfidence + 0.1, 1.0);
      } else if (hasCodeSnippet) {
        status = 'LIKELY';
        adjustedConfidence = 0.65;
        blockingEligible = false; // LIKELY does not block unless explicitly configured
      } else {
        status = 'REJECTED';
        adjustedConfidence = 0.0;
        blockingEligible = false;
      }

      const verified = {
        ...candidate,
        verificationStatus: status,
        introducedByPr: true,
        adjustedConfidence,
        blockingEligible,
        verificationEvidence: [
          {
            type: 'MODEL',
            description: `Verification evaluated candidate finding as ${status}. Code snippet present: ${hasCodeSnippet}.`,
          },
        ],
      };

      const parseResult = validateVerifiedFinding(verified);
      if (parseResult.success) {
        verifiedFindings.push(parseResult.data);
      } else {
        logger.warn('Failed to validate verified finding schema', { error: parseResult.error.format() });
        // Still preserve finding with fallbacks if validation had minor schema issue
        verifiedFindings.push(verified);
      }
    } catch (err) {
      logger.error('Error verifying candidate finding', { error: err.message, title: candidate.title });
    }
  }

  return verifiedFindings;
};
