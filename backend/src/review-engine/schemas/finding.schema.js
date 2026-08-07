import { z } from 'zod';

export const FindingCategoryEnum = z.enum([
  // Core 8 Review Pillars
  'FUNCTIONAL_CORRECTNESS',
  'SECURITY_PRIVACY',
  'RELIABILITY',
  'DATA_INTEGRITY',
  'PERFORMANCE',
  'ARCHITECTURE',
  'TESTING',
  'OBSERVABILITY',

  // Category Aliases & Static Scanners (for backward compatibility)
  'SECURITY',
  'LOGIC',
  'STYLE',
  'GIT_HYGIENE',
  'API_CONTRACT',
  'DATABASE',
  'DEPENDENCY_RISK',
  'CONCURRENCY',
]);

export const FindingSeverityEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export const VerificationStatusEnum = z.enum(['VERIFIED', 'LIKELY', 'UNVERIFIED', 'REJECTED']);

export const FindingStatusEnum = z.enum([
  'NEW',
  'OPEN',
  'RESOLVED',
  'REOPENED',
  'DISMISSED',
  'ACCEPTED_RISK',
  'OUTDATED',
]);

export const MergeDecisionEnum = z.enum(['PASS', 'WARNING', 'ACTION_REQUIRED', 'INCOMPLETE']);

export const SuggestedFixSchema = z.object({
  before: z.string().optional(),
  after: z.string(),
});

export const CandidateFindingSchema = z.object({
  source: z.enum(['AI', 'STATIC', 'DEPENDENCY_SCANNER']).default('AI'),
  sourceAgent: z.string(),
  ruleId: z.string().nullable().optional(),
  category: FindingCategoryEnum,
  pillar: FindingCategoryEnum.optional(),
  title: z.string().min(1),
  description: z.string().default('Finding description'),
  filePath: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  side: z.enum(['RIGHT', 'LEFT']).default('RIGHT'),
  severity: FindingSeverityEnum,
  confidence: z.number().min(0).max(1).default(0.8),
  evidence: z.object({
    changedCode: z.string().default(''),
    relatedContext: z.string().nullable().optional(),
    reasoning: z.string().default('Evidence reasoning'),
  }),
  impact: z.string().default('Impact evaluation'),
  recommendation: z.string().nullable().optional(),
  suggestedFix: SuggestedFixSchema.nullable().optional(),
});

export const VerifiedFindingSchema = CandidateFindingSchema.extend({
  fingerprint: z.string().optional().default(''),
  codeAnchor: z.string().optional().default(''),
  verificationStatus: VerificationStatusEnum,
  introducedByPr: z.boolean().default(true),
  introducedBySha: z.string().nullable().optional(),
  introductionReason: z.string().nullable().optional(),
  adjustedConfidence: z.number().min(0).max(1),
  blockingEligible: z.boolean(),
  verifierReasoning: z.string().nullable().optional(),
  counterEvidence: z.array(z.string()).optional().default([]),
  verificationEvidence: z.array(
    z.object({
      type: z.enum(['STATIC', 'CONTEXT', 'MODEL']),
      description: z.string(),
      reference: z.string().nullable().optional(),
    })
  ).default([]),
});

export const validateCandidateFinding = (data) => {
  return CandidateFindingSchema.safeParse(data);
};

export const validateVerifiedFinding = (data) => {
  return VerifiedFindingSchema.safeParse(data);
};

