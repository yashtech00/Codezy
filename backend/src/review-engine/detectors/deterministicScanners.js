import { runGitHygieneStaticAnalysis } from '../../agents/gitHygieneRules.js';

export const DETERMINISTIC_RULES = [
  {
    id: 'sec-hardcoded-secret',
    pillar: 'SECURITY_PRIVACY',
    category: 'SECURITY',
    title: 'Hardcoded Secret Key Committed',
    severity: 'CRITICAL',
    regex: /(AIzaSy[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|super_secret_[A-Za-z0-9_]+|-----BEGIN PRIVATE KEY-----)/,
    impact: 'Hardcoded credentials in source control allow unauthorized access and account compromise.',
    recommendation: 'Move sensitive credentials to environment variables or secret manager.',
  },
  {
    id: 'sec-unsafe-eval',
    pillar: 'SECURITY_PRIVACY',
    category: 'SECURITY',
    title: 'Unsafe Code Execution via eval()',
    severity: 'CRITICAL',
    regex: /\beval\s*\(/,
    impact: 'Using eval() exposes application to arbitrary remote code execution vulnerabilities.',
    recommendation: 'Replace eval() with safe JSON parsing or explicit math functions.',
  },
  {
    id: 'sec-raw-sql-concat',
    pillar: 'SECURITY_PRIVACY',
    category: 'SECURITY',
    title: 'SQL Injection via String Concatenation',
    severity: 'HIGH',
    regex: /(SELECT|INSERT|UPDATE|DELETE).*\+.*req\.(body|params|query)/i,
    impact: 'Raw input concatenated into SQL queries allows SQL injection attacks.',
    recommendation: 'Use parameterized queries ($1, $2) or ORM query builder.',
  },
  {
    id: 'rel-empty-catch-block',
    pillar: 'RELIABILITY',
    category: 'LOGIC',
    title: 'Swallowed Exception in Empty Catch Block',
    severity: 'MEDIUM',
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/,
    impact: 'Swallowing errors without logging or handling causes silent failures in production.',
    recommendation: 'Log the error or rethrow exception with context.',
  },
];

/**
 * Runs all deterministic static scanners on changed diff files.
 * Zero LLM token cost, 0.95+ baseline confidence.
 */
export function runDeterministicScanners(files = [], stats = {}) {
  const candidateFindings = [];

  // 1. Run Git Hygiene static rules
  const gitHygieneIssues = runGitHygieneStaticAnalysis(files, stats);
  gitHygieneIssues.forEach((issue) => {
    candidateFindings.push({
      source: 'STATIC',
      sourceAgent: 'git_hygiene_scanner',
      ruleId: issue.rule || 'git-hygiene-rule',
      pillar: 'ARCHITECTURE',
      category: 'GIT_HYGIENE',
      title: issue.title || issue.rule || 'Git Hygiene Violation',
      description: issue.description || issue.message || 'Git hygiene policy check failed',
      filePath: issue.file || issue.filePath || files[0]?.filename || 'unknown',
      startLine: issue.line || 1,
      endLine: issue.line || 1,
      side: 'RIGHT',
      severity: (issue.severity || 'MEDIUM').toUpperCase(),
      confidence: 0.95,
      evidence: {
        changedCode: issue.snippet || '',
        reasoning: issue.explanation || 'Static rule pattern match',
      },
      impact: issue.impact || 'Code quality or repository policy violation',
      recommendation: issue.recommendation || issue.suggestion || 'Follow repo hygiene guidelines',
      suggestedFix: issue.suggestedFix || null,
    });
  });

  // 2. Run Deterministic Rule Regex Scanners across patch additions
  for (const file of files) {
    if (!file.patch) continue;
    const lines = file.patch.split('\n');

    let currentLine = 1;
    for (const line of lines) {
      if (line.startsWith('@@')) {
        const match = line.match(/\+(\d+)/);
        if (match) currentLine = parseInt(match[1], 10);
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        const addedCode = line.substring(1);

        for (const rule of DETERMINISTIC_RULES) {
          if (rule.regex.test(addedCode)) {
            candidateFindings.push({
              source: 'STATIC',
              sourceAgent: 'deterministic_scanner',
              ruleId: rule.id,
              pillar: rule.pillar,
              category: rule.category,
              title: rule.title,
              description: `${rule.title} detected in added line.`,
              filePath: file.filename,
              startLine: currentLine,
              endLine: currentLine,
              side: 'RIGHT',
              severity: rule.severity,
              confidence: 0.98,
              evidence: {
                changedCode: addedCode.trim(),
                reasoning: `Matched deterministic rule [${rule.id}]: ${rule.regex.toString()}`,
              },
              impact: rule.impact,
              recommendation: rule.recommendation,
            });
          }
        }
      }

      if (!line.startsWith('-')) {
        currentLine++;
      }
    }
  }

  return candidateFindings;
}
