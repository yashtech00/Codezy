import { describe, it, expect } from '@jest/globals';
import { validateCandidateFinding, validateVerifiedFinding } from '../review-engine/schemas/finding.schema.js';
import { classifyPushChanges, classifyFile } from '../review-engine/classification/changeClassifier.js';
import { fitPatchesToBudget, compressPatch, estimateTokens } from '../review-engine/context/tokenBudgetManager.js';
import { extractImports, extractSymbolSignatures, retrieveHunkContext } from '../review-engine/context/contextRetriever.js';
import { runDeterministicScanners } from '../review-engine/detectors/deterministicScanners.js';
import { verifyCandidates } from '../review-engine/agents/verification/verification.agent.js';
import { parseRepoConfig, getPathInstructions } from '../review-engine/config/repoConfigParser.js';

describe('Production AI Code Review Engine — Architecture Test Suite', () => {
  describe('1. 8 Review Pillars & Schema Gating', () => {
    it('should validate CandidateFinding with 8 Review Pillars', () => {
      const candidate = {
        source: 'AI',
        sourceAgent: 'security_agent',
        pillar: 'SECURITY_PRIVACY',
        category: 'SECURITY',
        title: 'Broken Object Level Authorization',
        description: 'Resource owner check missing before user record deletion.',
        filePath: 'backend/src/controllers/userController.js',
        startLine: 45,
        endLine: 45,
        severity: 'CRITICAL',
        confidence: 0.92,
        evidence: {
          changedCode: 'await prisma.user.delete({ where: { id: req.params.id } });',
          reasoning: 'Missing req.user.id ownership check.',
        },
        impact: 'IDOR vulnerability allowing unauthorized user deletion.',
        recommendation: 'Verify user ownership before deleting record.',
        suggestedFix: {
          before: 'where: { id: req.params.id }',
          after: 'where: { id: req.params.id, ownerId: req.user.id }',
        },
      };

      const result = validateCandidateFinding(candidate);
      expect(result.success).toBe(true);
    });
  });

  describe('2. Change Classifier & Risk Router', () => {
    it('should classify authentication file as AUTHENTICATION with high base risk', () => {
      const type = classifyFile('backend/src/routes/authController.js');
      expect(type).toBe('AUTHENTICATION');
    });

    it('should route auth/payment changes to POWERFUL_PLUS_VERIFIER tier', () => {
      const files = [
        { filename: 'src/services/payment.js', patch: '+ const stripeKey = "secret";' },
      ];
      const stats = { totalLinesChanged: 80, totalFiles: 1 };
      
      const classification = classifyPushChanges(files, stats);
      expect(classification.baseRiskScore).toBeGreaterThanOrEqual(6);
      expect(classification.route).toBe('POWERFUL_PLUS_VERIFIER');
      expect(classification.pillars).toContain('SECURITY_PRIVACY');
    });

    it('should skip documentation-only changes', () => {
      const files = [{ filename: 'README.md', patch: '+ # Project Docs' }];
      const classification = classifyPushChanges(files, { totalLinesChanged: 5, totalFiles: 1 });
      expect(classification.route).toBe('SKIP');
    });
  });

  describe('3. Token Budget Manager & Patch Compression', () => {
    it('should calculate approximate token count accurately', () => {
      const text = 'abcdefgh'; // 8 chars -> ~2 tokens
      expect(estimateTokens(text)).toBe(2);
    });

    it('should compress diff patches across levels', () => {
      const file = {
        filename: 'src/index.js',
        patch: '@@ -1,3 +1,3 @@\n- var x = 1;\n+ const x = 1;',
      };

      const l1 = compressPatch(file, 1);
      const l2 = compressPatch(file, 2);
      const l4 = compressPatch(file, 4);

      expect(l1).toContain('File: src/index.js');
      expect(l2).toContain('Compressed Hunks');
      expect(l4).toContain('Metadata only');
    });

    it('should fit patches strictly within token budget', () => {
      const files = [
        { filename: 'src/a.js', patch: '+ line A\n'.repeat(100) },
        { filename: 'src/b.js', patch: '+ line B\n'.repeat(100) },
      ];

      const { formattedDiffPrompt, usedTokens } = fitPatchesToBudget(files, 200);
      expect(usedTokens).toBeLessThanOrEqual(200);
      expect(formattedDiffPrompt).toBeDefined();
    });
  });

  describe('4. AST Code Intelligence & Context Retriever', () => {
    it('should extract imports and function signatures from code', () => {
      const code = `
import prisma from '../config/db.js';
export async function deleteUser(userId) {
  return prisma.user.delete({ where: { id: userId } });
}
`;
      const imports = extractImports(code);
      const signatures = extractSymbolSignatures(code);

      expect(imports).toContain('../config/db.js');
      expect(signatures.some(s => s.symbol === 'deleteUser')).toBe(true);
    });

    it('should retrieve hunk context formatted prompt', async () => {
      const files = [
        {
          filename: 'src/service.js',
          content: "import { auth } from './auth.js';\nexport function run() {}",
          patch: '@@ -1,2 +1,3 @@\n+ run();',
        },
      ];

      const context = await retrieveHunkContext({ changedFiles: files });
      expect(context.formattedContextPrompt).toContain('src/service.js');
    });
  });

  describe('5. Deterministic Scanners Pipeline', () => {
    it('should detect hardcoded API keys with static scanner (0 LLM cost, 0.98 confidence)', () => {
      const files = [
        {
          filename: 'backend/src/config.js',
          patch: '@@ -1,2 +1,3 @@\n+ const GEMINI_KEY = "AIzaSyDummySecretKey123456789123456789";',
        },
      ];

      const candidates = runDeterministicScanners(files);
      expect(candidates.length).toBeGreaterThan(0);

      const secretFinding = candidates.find(c => c.ruleId === 'sec-hardcoded-secret');
      expect(secretFinding).toBeDefined();
      expect(secretFinding.source).toBe('STATIC');
      expect(secretFinding.confidence).toBe(0.98);
      expect(secretFinding.severity).toBe('CRITICAL');
    });

    it('should detect unsafe eval() calls deterministically', () => {
      const files = [
        {
          filename: 'src/calc.js',
          patch: '@@ -5,1 +5,1 @@\n+ return eval(userInput);',
        },
      ];

      const candidates = runDeterministicScanners(files);
      const evalFinding = candidates.find(c => c.ruleId === 'sec-unsafe-eval');
      expect(evalFinding).toBeDefined();
      expect(evalFinding.severity).toBe('CRITICAL');
    });
  });

  describe('6. Selective LLM Verifier Agent Pass', () => {
    it('should assign VERIFIED status to static scanner findings automatically', async () => {
      const staticCandidates = [
        {
          source: 'STATIC',
          sourceAgent: 'deterministic_scanner',
          category: 'SECURITY',
          title: 'Hardcoded secret',
          filePath: 'config.js',
          startLine: 10,
          endLine: 10,
          severity: 'CRITICAL',
          confidence: 0.98,
        },
      ];

      const verified = await verifyCandidates(staticCandidates);
      expect(verified.length).toBe(1);
      expect(verified[0].verificationStatus).toBe('VERIFIED');
      expect(verified[0].blockingEligible).toBe(true);
    });
  });

  describe('7. Repository Config Parser (.codereview.yml)', () => {
    it('should parse valid YAML config or fall back to defaults', () => {
      const rawYaml = `
version: "2.0"
review:
  max_comments: 5
`;
      const config = parseRepoConfig(rawYaml);
      expect(config.review.max_comments).toBe(5);
    });

    it('should resolve path-specific instructions', () => {
      const config = parseRepoConfig();
      const instructions = getPathInstructions('src/controllers/userController.js', config);
      expect(instructions).toBeDefined();
      expect(instructions.focus).toContain('SECURITY_PRIVACY');
    });
  });
});
