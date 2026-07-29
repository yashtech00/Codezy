import { describe, it, expect } from '@jest/globals';
import { validateCandidateFinding } from '../review-engine/schemas/finding.schema.js';
import { generateFingerprint, buildCodeAnchor } from '../review-engine/findings/fingerprint.js';
import { deduplicateFindings } from '../review-engine/findings/deduplicate.js';
import { verifyCandidates } from '../review-engine/agents/verification/verification.agent.js';
import { computePRMetrics, calculateFindingRisk } from '../review-engine/scoring/scoring.js';
import { evaluatePolicy } from '../review-engine/policies/policyEngine.js';

describe('Codezy Level 2 Engine Unit Tests', () => {
  describe('Finding Schema Validation', () => {
    it('should validate a valid CandidateFinding object', () => {
      const candidate = {
        source: 'AI',
        sourceAgent: 'security',
        category: 'SECURITY',
        title: 'SQL Injection Vulnerability',
        description: 'User input directly concatenated into SQL query string.',
        filePath: 'backend/src/routes/users.js',
        startLine: 12,
        endLine: 12,
        side: 'RIGHT',
        severity: 'HIGH',
        confidence: 0.9,
        evidence: {
          changedCode: "const query = 'SELECT * FROM users WHERE id = ' + req.params.id;",
          reasoning: 'Unsanitized input used in SQL query.',
        },
        impact: 'Remote code execution or data exfiltration.',
        recommendation: 'Use parameterized queries or ORM.',
      };

      const result = validateCandidateFinding(candidate);
      expect(result.success).toBe(true);
    });

    it('should reject a CandidateFinding missing mandatory fields', () => {
      const invalidCandidate = {
        title: 'Short',
      };
      const result = validateCandidateFinding(invalidCandidate);
      expect(result.success).toBe(false);
    });
  });

  describe('Fingerprinting & Code Anchors', () => {
    it('should generate stable fingerprint for identical code anchor and rule', () => {
      const codeAnchor1 = buildCodeAnchor('const x = eval(input);', 'Eval Usage', 10);
      const codeAnchor2 = buildCodeAnchor('const x = eval(input);', 'Eval Usage', 25);

      expect(codeAnchor1).toBe(codeAnchor2);

      const fp1 = generateFingerprint({
        repositoryId: 'repo123',
        filePath: 'src/app.js',
        category: 'SECURITY',
        ruleId: 'no-eval',
        title: 'Eval Usage',
        codeAnchor: codeAnchor1,
      });

      const fp2 = generateFingerprint({
        repositoryId: 'repo123',
        filePath: 'src/app.js',
        category: 'SECURITY',
        ruleId: 'no-eval',
        title: 'Eval Usage',
        codeAnchor: codeAnchor2,
      });

      expect(fp1).toBe(fp2);
    });
  });

  describe('Deduplication Engine', () => {
    it('should merge duplicate findings from multiple agents and prioritize STATIC scanner', () => {
      const candidates = [
        {
          source: 'AI',
          sourceAgent: 'security',
          category: 'SECURITY',
          title: 'Hardcoded Secret',
          description: 'Secret detected by AI',
          filePath: 'config.js',
          startLine: 5,
          endLine: 5,
          severity: 'HIGH',
          confidence: 0.8,
          evidence: { changedCode: 'const secret = "12345"', reasoning: 'AI reason' },
          impact: 'Credential leak',
        },
        {
          source: 'STATIC',
          sourceAgent: 'git_hygiene',
          category: 'SECURITY',
          title: 'Hardcoded Secret',
          description: 'Secret detected by Git Hygiene static scanner',
          filePath: 'config.js',
          startLine: 5,
          endLine: 5,
          severity: 'HIGH',
          confidence: 0.98,
          evidence: { changedCode: 'const secret = "12345"', reasoning: 'Static rule match' },
          impact: 'Credential leak',
        },
      ];

      const deduplicated = deduplicateFindings(candidates, 'test_repo');
      expect(deduplicated.length).toBe(1);
      expect(deduplicated[0].source).toBe('STATIC');
      expect(deduplicated[0].sourceAgents).toContain('security');
      expect(deduplicated[0].sourceAgents).toContain('git_hygiene');
    });
  });

  describe('Verification Engine', () => {
    it('should assign VERIFIED status to candidates with complete code evidence', async () => {
      const candidates = [
        {
          source: 'AI',
          sourceAgent: 'logic',
          category: 'LOGIC',
          title: 'Null Pointer Dereference',
          description: 'Object dereferenced without null check.',
          filePath: 'services/user.js',
          startLine: 15,
          endLine: 15,
          severity: 'HIGH',
          confidence: 0.85,
          evidence: {
            changedCode: 'const name = user.profile.name;',
            reasoning: 'user.profile may be undefined when user is null.',
          },
          impact: 'Application crash.',
        },
      ];

      const verified = await verifyCandidates(candidates);
      expect(verified.length).toBe(1);
      expect(verified[0].verificationStatus).toBe('VERIFIED');
      expect(verified[0].blockingEligible).toBe(true);
    });

    it('should assign REJECTED status to AI findings missing evidence', async () => {
      const candidates = [
        {
          source: 'AI',
          sourceAgent: 'logic',
          category: 'LOGIC',
          title: 'Vague assertion',
          description: 'Something might be wrong.',
          filePath: 'services/user.js',
          startLine: 1,
          endLine: 1,
          severity: 'LOW',
          confidence: 0.3,
          evidence: { changedCode: '', reasoning: '' },
          impact: 'Unknown',
        },
      ];

      const verified = await verifyCandidates(candidates);
      expect(verified.length).toBe(1);
      expect(verified[0].verificationStatus).toBe('REJECTED');
      expect(verified[0].blockingEligible).toBe(false);
    });
  });

  describe('Scoring & Policy Engine', () => {
    it('should calculate risk and policy decisions correctly', () => {
      const verifiedFindings = [
        {
          severity: 'CRITICAL',
          category: 'SECURITY',
          verificationStatus: 'VERIFIED',
          adjustedConfidence: 0.95,
          introducedByPr: true,
          blockingEligible: true,
          findingId: 'f1',
        },
      ];

      const metrics = computePRMetrics(verifiedFindings, 100);
      expect(metrics.riskScore).toBeGreaterThan(0);
      expect(metrics.blockingCount).toBe(1);

      const policy = evaluatePolicy({
        verifiedFindings,
        metrics,
        repoConfig: {},
      });

      expect(policy.decision).toBe('ACTION_REQUIRED');
      expect(policy.matchedRules[0].ruleId).toBe('block.verified_critical');
    });
  });
});
