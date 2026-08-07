import { validateVerifiedFinding } from '../../schemas/finding.schema.js';
import { generateAgentCompletion, parseJsonFindings } from '../../../agents/reviewAgents.js';
import { logger } from '../../../shared/logger.js';

/**
 * CodeRabbit-Style Independent Verifier Engine
 * Evaluates candidate findings using code evidence, surrounding context, and LLM verification calls.
 */
export const verifyCandidates = async (candidateFindings = [], repositoryContext = null) => {
  if (!Array.isArray(candidateFindings) || candidateFindings.length === 0) {
    return [];
  }

  const verifiedFindings = [];
  const requiresLlmVerification = [];

  // Step 1: Handle Static Scanners & Trivial candidates
  for (const candidate of candidateFindings) {
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

    // High-risk or uncertain candidates require selective LLM verification
    const isHighImpact = ['CRITICAL', 'HIGH'].includes(candidate.severity) ||
                         ['SECURITY_PRIVACY', 'SECURITY', 'RELIABILITY', 'DATA_INTEGRITY'].includes(candidate.category);
    const isUncertainConfidence = candidate.confidence >= 0.5 && candidate.confidence <= 0.88;

    if (isHighImpact || isUncertainConfidence) {
      requiresLlmVerification.push(candidate);
    } else {
      const hasCodeSnippet = Boolean(candidate.evidence?.changedCode && candidate.evidence.changedCode.trim().length > 0);
      const isLowConfidence = (candidate.confidence || 0.8) < 0.5;

      let status = 'LIKELY';
      let adjustedConfidence = candidate.confidence || 0.75;
      let blockingEligible = false;

      if (hasCodeSnippet && !isLowConfidence) {
        status = 'VERIFIED';
        adjustedConfidence = Math.min(adjustedConfidence + 0.1, 1.0);
        blockingEligible = ['CRITICAL', 'HIGH'].includes(candidate.severity);
      } else if (!hasCodeSnippet && isLowConfidence) {
        status = 'REJECTED';
        adjustedConfidence = 0.0;
      }

      verifiedFindings.push({
        ...candidate,
        verificationStatus: status,
        introducedByPr: true,
        adjustedConfidence,
        blockingEligible,
        verificationEvidence: [
          {
            type: 'CONTEXT',
            description: `Selective verification evaluated candidate with status ${status}.`,
          },
        ],
      });
    }
  }

  // Step 2: Selective LLM Verification Pass for High-Risk / Uncertain Candidates
  if (requiresLlmVerification.length > 0) {
    logger.info(`Running LLM Verification Pass on ${requiresLlmVerification.length} candidate finding(s)...`);

    const prompt = `You are a Senior Security & Quality Verification Agent.
Your single goal is to attempt to DISPROVE each candidate code review finding to eliminate false positives.

For each finding below, analyze the changed code snippet and context:
1. Is this code execution path actually reachable?
2. Is validation or authorization already enforced upstream?
3. Did this code behavior exist before this push?
4. Is there explicit counter-evidence showing this finding is wrong or a nitpick?

Candidates to verify:
${JSON.stringify(requiresLlmVerification.map((c, idx) => ({
  id: idx,
  title: c.title,
  category: c.category,
  severity: c.severity,
  file: c.filePath,
  line: c.startLine,
  codeSnippet: c.evidence?.changedCode,
  reasoning: c.evidence?.reasoning,
})), null, 2)}

Return a strict JSON array with your verification verdict for each finding (same order):
[
  {
    "id": 0,
    "valid": true | false,
    "verificationStatus": "VERIFIED" | "LIKELY" | "REJECTED",
    "adjustedConfidence": 0.95,
    "counterEvidence": ["Optional explanation if rejected"],
    "verifierReasoning": "Concise proof why finding is valid or why it was rejected"
  }
]
`;

    try {
      const responseText = await generateAgentCompletion(prompt, 100);
      const verdicts = parseJsonFindings(responseText, 'VerificationAgent') || [];

      requiresLlmVerification.forEach((candidate, idx) => {
        const verdict = verdicts.find((v) => v.id === idx) || verdicts[idx];

        let status = verdict?.verificationStatus || (verdict?.valid ? 'VERIFIED' : 'REJECTED');
        if (!verdict) status = candidate.confidence > 0.75 ? 'VERIFIED' : 'LIKELY';

        const adjustedConfidence = verdict?.adjustedConfidence ?? (status === 'VERIFIED' ? 0.9 : status === 'REJECTED' ? 0.0 : 0.65);
        const blockingEligible = status === 'VERIFIED' && ['CRITICAL', 'HIGH'].includes(candidate.severity);

        const verified = {
          ...candidate,
          verificationStatus: status,
          introducedByPr: true,
          adjustedConfidence,
          blockingEligible,
          verifierReasoning: verdict?.verifierReasoning || 'LLM verification evaluation completed.',
          counterEvidence: verdict?.counterEvidence || [],
          verificationEvidence: [
            {
              type: 'MODEL',
              description: `Verifier agent evaluated candidate as ${status} (confidence: ${adjustedConfidence}).`,
            },
          ],
        };

        const parseResult = validateVerifiedFinding(verified);
        if (parseResult.success) {
          verifiedFindings.push(parseResult.data);
        } else {
          verifiedFindings.push(verified);
        }
      });
    } catch (err) {
      logger.error('LLM Verifier pass failed — falling open to candidate findings', { error: err.message });
      requiresLlmVerification.forEach((c) => {
        verifiedFindings.push({
          ...c,
          verificationStatus: 'LIKELY',
          adjustedConfidence: c.confidence || 0.75,
          blockingEligible: false,
        });
      });
    }
  }

  return verifiedFindings;
};
