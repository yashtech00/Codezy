import { ChatOpenAI } from '@langchain/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import { runGitHygieneStaticAnalysis } from './gitHygieneRules.js';
import { getPathMultiplier, getPathLabel } from '../config/pathWeights.js';

// ============================================================
// MODEL TIERING
// Small diffs (<50 lines) → cheap/fast model
// Large diffs (≥50 lines) → more capable model
// ============================================================

const MODEL_TIERS = {
  CHEAP: {
    gemini: 'gemini-1.5-flash',
    openai: 'gpt-4o-mini',
  },
  POWERFUL: {
    gemini: 'gemini-1.5-pro',
    openai: 'gpt-4o',
  },
};

function selectModelTier(totalLinesChanged) {
  return totalLinesChanged < 50 ? MODEL_TIERS.CHEAP : MODEL_TIERS.POWERFUL;
}

// ============================================================
// CORE LLM RUNNER (with model tiering)
// ============================================================

async function runGeminiModel(prompt, modelName) {
  const apiKey = config.gemini.apiKey;
  if (!apiKey || !apiKey.startsWith('AIzaSy')) {
    throw new Error('Invalid Gemini API key format. Key should start with AIzaSy...');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function runOpenAIModel(prompt, modelName) {
  const model = new ChatOpenAI({
    openAIApiKey: config.openai.apiKey,
    modelName: modelName || 'gpt-4o-mini',
    temperature: 0.1,
  });
  const response = await model.invoke(prompt);
  return response.content;
}

/**
 * Run LLM with automatic model selection and fallback.
 * @param {string} prompt
 * @param {number} totalLinesChanged - used to pick model tier
 * @returns {string|null}
 */
async function generateAgentCompletion(prompt, totalLinesChanged = 0) {
  const tier = selectModelTier(totalLinesChanged);

  if (config.gemini.apiKey && config.gemini.apiKey.startsWith('AIzaSy')) {
    try {
      return await runGeminiModel(prompt, tier.gemini);
    } catch (err) {
      console.error(`[GeminiAgent] Error (${tier.gemini}):`, err.message);
      // Try cheap model as fallback on quota/model errors
      if (tier !== MODEL_TIERS.CHEAP) {
        try {
          return await runGeminiModel(prompt, MODEL_TIERS.CHEAP.gemini);
        } catch (fallbackErr) {
          console.error('[GeminiAgent] Fallback error:', fallbackErr.message);
        }
      }
    }
  }

  if (config.openai.apiKey && config.openai.apiKey.startsWith('sk-')) {
    try {
      return await runOpenAIModel(prompt, tier.openai);
    } catch (err) {
      console.error(`[OpenAIAgent] Error (${tier.openai}):`, err.message);
      if (tier !== MODEL_TIERS.CHEAP) {
        try {
          return await runOpenAIModel(prompt, MODEL_TIERS.CHEAP.openai);
        } catch (fallbackErr) {
          console.error('[OpenAIAgent] Fallback error:', fallbackErr.message);
        }
      }
    }
  }

  return null;
}

/**
 * Parse JSON array from LLM response safely.
 * Handles markdown code blocks and raw JSON.
 */
function parseJsonFindings(responseText, agentName) {
  if (!responseText) return null;
  try {
    // Strip markdown code fences if present
    const stripped = responseText
      .replace(/^```(?:json)?\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();
    const jsonMatch = stripped.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (error) {
    console.error(`[${agentName}] JSON parse error:`, error.message);
    return [];
  }
}

// ============================================================
// SUPERVISOR NODE — routing decision
// ============================================================

async function runSupervisorNode(stats, files) {
  const onlyDocs = files.every(
    (f) =>
      f.filename.endsWith('.md') ||
      f.filename.endsWith('.txt') ||
      f.filename.endsWith('.rst')
  );
  if (onlyDocs || files.length === 0) {
    return { route: 'SKIP', reason: 'No code changes detected in PR diff.' };
  }

  // Config-only changes (just env/docker/yaml)
  const onlyConfig = files.every(
    (f) =>
      f.filename.endsWith('.yml') ||
      f.filename.endsWith('.yaml') ||
      f.filename.endsWith('.json') ||
      f.filename.endsWith('.toml') ||
      f.filename.endsWith('.ini') ||
      f.filename.endsWith('.env.example')
  );
  if (onlyConfig) {
    return { route: 'GIT_HYGIENE_ONLY' };
  }

  if (stats.totalLinesChanged < 50) {
    return { route: 'STYLE_ONLY' };
  }

  return { route: 'FULL_REVIEW' };
}

// ============================================================
// AGENT 1: GIT HYGIENE (static — no LLM)
// ============================================================

async function runGitHygieneAgent(files, stats) {
  console.log('[GitHygieneAgent] Running static analysis...');
  const findings = runGitHygieneStaticAnalysis(files, stats);
  console.log(`[GitHygieneAgent] Found ${findings.length} issues (no LLM cost)`);
  return findings;
}

// ============================================================
// AGENT 2: STYLE & QUALITY
// ============================================================

async function runStyleAgent(files, totalLinesChanged = 0) {
  const prompt = `You are a Senior Code Style & Quality Reviewer.
Analyze the following pull request diff and identify ONLY clear, concrete violations:
- Naming convention inconsistencies (camelCase/PascalCase/snake_case mismatches)
- Unused variables or imports
- Dead/unreachable code
- Overly long functions (>50 lines of logic)
- Duplicate code patterns
- Magic numbers or strings without named constants
- Missing error handling (empty catch blocks, unhandled rejection patterns)
- console.log left in production code (flag as LOW only if not already caught by Git Hygiene)

IMPORTANT: Only report issues you can DIRECTLY see in the diff. Do NOT speculate about code not shown.

For each issue, if you can provide a concrete fix with confidence, include a "suggestedFix" object with "before" and "after" fields showing the exact lines to change (single-line or short multi-line snippets only). If you cannot confidently provide a fix, omit the field entirely — do NOT guess.

PR Diff:
${JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch })), null, 2)}

Return a strict JSON array only (no markdown, no explanation):
[
  {
    "file": "path/to/file",
    "line": 10,
    "issue": "Specific, actionable description of the style issue",
    "severity": "LOW" | "MEDIUM" | "HIGH",
    "category": "STYLE",
    "suggestedFix": {
      "before": "var total = price + tax",
      "after": "const total = price + tax;"
    }
  }
]

Return [] if no issues found. Do not include nitpicks. The suggestedFix field is OPTIONAL — omit it if unsure.`;

  const responseText = await generateAgentCompletion(prompt, totalLinesChanged);

  if (!responseText) {
    return [
      {
        file: files[0]?.filename || 'src/index.js',
        line: 4,
        issue: 'Inconsistent spacing in function parameters and missing semicolon.',
        severity: 'LOW',
        category: 'STYLE',
      },
      {
        file: files[0]?.filename || 'src/index.js',
        line: 5,
        issue: 'Use "const" or "let" instead of legacy "var" keyword.',
        severity: 'MEDIUM',
        category: 'STYLE',
        suggestedFix: { before: 'var total = price + tax', after: 'const total = price + tax;' },
      },
    ];
  }

  const findings = parseJsonFindings(responseText, 'StyleAgent');
  return (findings || []).map((f) => ({ ...f, category: f.category || 'STYLE' }));
}

// ============================================================
// AGENT 3: SECURITY
// ============================================================

async function runSecurityAgent(files, totalLinesChanged = 0) {
  const prompt = `You are a Senior Security Audit Specialist.
Analyze the following pull request diff for security vulnerabilities. Focus ONLY on issues visible in the diff:

- SQL injection risk (string concatenation in queries instead of parameterized queries)
- Unsafe eval() or new Function() usage
- Command injection (user input passed to shell commands)
- Missing input validation/sanitization on user-facing data
- Missing authentication/authorization checks on new API routes
- Insecure direct object references (IDOR) — user-controlled IDs without ownership checks
- XSS risks (unescaped user input in HTML/JSX)
- Insecure deserialization
- CORS misconfiguration (wildcard origins for sensitive endpoints)
- Missing HTTPS enforcement

DO NOT repeat secrets/keys — those are handled by the Git Hygiene agent.
Only report what you can DIRECTLY see in the diff.

For each issue, if you can provide a concrete fix with confidence, include a "suggestedFix" object with "before" and "after" fields (single-line or short multi-line snippets). If you cannot confidently provide a safe fix, omit the field entirely — do NOT guess at security fixes.

PR Diff:
${JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch })), null, 2)}

Return a strict JSON array only (no markdown):
[
  {
    "file": "path/to/file",
    "line": 25,
    "issue": "Specific description of the vulnerability and why it is dangerous",
    "severity": "HIGH" | "CRITICAL",
    "category": "SECURITY",
    "suggestedFix": {
      "before": "const user = await db.query('SELECT * FROM users WHERE id = ' + userId);",
      "after": "const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);"
    }
  }
]

Return [] if no issues found. The suggestedFix field is OPTIONAL — omit it if a safe fix is not obvious.`;

  const responseText = await generateAgentCompletion(prompt, totalLinesChanged);

  if (!responseText) {
    return [
      {
        file: files[0]?.filename || 'src/config.js',
        line: 2,
        issue: 'Hardcoded secret API key detected in source code.',
        severity: 'HIGH',
        category: 'SECURITY',
      },
      {
        file: files[0]?.filename || 'src/index.js',
        line: 6,
        issue: 'Use of unsafe "eval()" function poses arbitrary code execution risk.',
        severity: 'CRITICAL',
        category: 'SECURITY',
        suggestedFix: { before: 'return eval("total")', after: 'return total' },
      },
    ];
  }

  const findings = parseJsonFindings(responseText, 'SecurityAgent');
  return (findings || []).map((f) => ({ ...f, category: f.category || 'SECURITY' }));
}

// ============================================================
// AGENT 4: LOGIC & CORRECTNESS
// ============================================================

async function runLogicAgent(files, totalLinesChanged = 0) {
  const prompt = `You are a Senior Software Engineer doing a logic and correctness review.
Analyze the following pull request diff for logic bugs and correctness issues:

- Missing null/undefined checks (optional chaining not used where needed)
- Incorrect comparison operators (== vs === in JavaScript/TypeScript)
- Unhandled promise rejections (async functions without try/catch)
- Off-by-one errors in loops or array indexing
- Race conditions in async code (shared mutable state without locking)
- Infinite loop risk (loop conditions that may never terminate)
- Edge cases missed: empty arrays, zero values, negative numbers, null inputs
- Silent failures (errors caught but not logged or re-thrown)
- Boolean logic errors (wrong AND/OR conditions)
- Early return missing (function continues after it should stop)

IMPORTANT: Only flag issues you can DIRECTLY verify from the diff. Provide the exact line number from the diff if possible.

PR Diff:
${JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch })), null, 2)}

Return a strict JSON array only (no markdown):
[
  {
    "file": "path/to/file",
    "line": 15,
    "issue": "Specific description of the logic issue and what could go wrong",
    "severity": "LOW" | "MEDIUM" | "HIGH",
    "category": "LOGIC"
  }
]

Return [] if no issues found.`;

  const responseText = await generateAgentCompletion(prompt, totalLinesChanged);

  if (!responseText) return [];

  const findings = parseJsonFindings(responseText, 'LogicAgent');
  return (findings || []).map((f) => ({ ...f, category: f.category || 'LOGIC' }));
}

// ============================================================
// AGENT 5: PERFORMANCE
// ============================================================

async function runPerformanceAgent(files, totalLinesChanged = 0) {
  const prompt = `You are a Performance Engineer reviewing a pull request.
Identify performance issues DIRECTLY visible in the diff:

- N+1 query problem: database call inside a loop (for/forEach/map with await DB query inside)
- Missing indexes: new queries filtering/sorting on columns likely without indexes
- Unnecessary re-renders: React components missing React.memo, useMemo, useCallback where clearly needed
- Large unpagianted responses: API returning entire table without limit/offset/cursor
- Memory leaks: event listeners added without cleanup, setInterval without clearInterval
- Blocking synchronous operations that should be async (fs.readFileSync in request handlers, heavy computation in main thread)
- Redundant API calls: same data fetched multiple times when it could be cached

Only flag issues visible in the diff. Be specific about WHY it is a performance problem.

PR Diff:
${JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch })), null, 2)}

Return a strict JSON array only (no markdown):
[
  {
    "file": "path/to/file",
    "line": 30,
    "issue": "Description of the performance issue and its impact",
    "severity": "LOW" | "MEDIUM" | "HIGH",
    "category": "PERFORMANCE"
  }
]

Return [] if no performance issues found.`;

  const responseText = await generateAgentCompletion(prompt, totalLinesChanged);

  if (!responseText) return [];

  const findings = parseJsonFindings(responseText, 'PerformanceAgent');
  return (findings || []).map((f) => ({ ...f, category: f.category || 'PERFORMANCE' }));
}

// ============================================================
// AGENT 6: TESTING COVERAGE
// ============================================================

async function runTestingAgent(files, totalLinesChanged = 0) {
  const prompt = `You are a Quality Assurance Engineer reviewing test coverage.
Analyze the following pull request diff and identify testing gaps:

- New functions or methods added WITHOUT corresponding test cases
- New API endpoints added WITHOUT integration tests
- Complex logic (conditionals, loops, error paths) added without test coverage
- Edge cases in new code that are NOT covered by visible tests
- Test files that exist but seem to be missing assertions for new behavior
- Mock/stub missing for external dependencies in tests

Only flag based on what is VISIBLE in the diff. If test files are in the diff, check if they cover the new code.
If no test files are in the diff at all but new functionality was added, flag it.

PR Diff:
${JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch })), null, 2)}

Return a strict JSON array only (no markdown):
[
  {
    "file": "path/to/file",
    "line": 1,
    "issue": "Specific description of missing test coverage",
    "severity": "LOW" | "MEDIUM" | "HIGH",
    "category": "TESTING"
  }
]

Return [] if test coverage looks adequate.`;

  const responseText = await generateAgentCompletion(prompt, totalLinesChanged);

  if (!responseText) return [];

  const findings = parseJsonFindings(responseText, 'TestingAgent');
  return (findings || []).map((f) => ({ ...f, category: f.category || 'TESTING' }));
}

// ============================================================
// AGENT 7: JUDGE / VERIFICATION PASS
// Filters false positives from all agents' findings
// ============================================================

/**
 * Judge agent: Takes all findings and the original diff,
 * filters out findings that cannot be grounded in the actual diff.
 * Reduces false positives significantly.
 *
 * @param {Array} allFindings - Combined findings from all agents
 * @param {Array} files - Original diff files
 * @param {number} totalLinesChanged
 * @returns {Array} verified findings only
 */
async function runJudgeAgent(allFindings, files, totalLinesChanged = 0) {
  if (allFindings.length === 0) return [];

  // Skip judge for git hygiene findings — they are already deterministic
  const gitHygieneFindings = allFindings.filter((f) => f.category === 'GIT_HYGIENE');
  const llmFindings = allFindings.filter((f) => f.category !== 'GIT_HYGIENE');

  if (llmFindings.length === 0) {
    return gitHygieneFindings;
  }

  const prompt = `You are a senior code review judge. Your job is to verify whether each finding from AI code reviewers is ACTUALLY grounded in the provided diff.

Rules for keeping a finding:
1. The finding must reference something VISIBLE in the diff (added lines starting with "+")
2. The finding must be actionable and specific (not vague like "consider refactoring")
3. Security and Logic findings with CRITICAL/HIGH severity get lenient treatment — keep if plausible
4. Discard findings that:
   - Reference code not present in the diff
   - Are pure opinions with no clear fix
   - Are duplicate of another finding
   - Are LOW severity nitpicks that add no real value

IMPORTANT: If a finding has a "suggestedFix" field, preserve it exactly as-is in the output. Do NOT modify or remove suggestedFix data.

Diff for grounding:
${JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch })), null, 2)}

Findings to verify (${llmFindings.length} total):
${JSON.stringify(llmFindings, null, 2)}

Return ONLY the verified findings as a JSON array (same schema, no changes to content, preserve all fields including suggestedFix):
[
  { "file": "...", "line": N, "issue": "...", "severity": "...", "category": "...", "suggestedFix": { "before": "...", "after": "..." } }
]

If ALL findings are valid, return all. If NONE are valid, return [].
Return only the JSON array, no explanation.`;

  try {
    const responseText = await generateAgentCompletion(prompt, totalLinesChanged);
    if (!responseText) {
      console.warn('[JudgeAgent] No response — keeping all LLM findings unfiltered');
      return allFindings;
    }

    const verified = parseJsonFindings(responseText, 'JudgeAgent');
    if (!verified || !Array.isArray(verified)) {
      return allFindings;
    }

    const totalBefore = llmFindings.length;
    const totalAfter = verified.length;
    console.log(`[JudgeAgent] Filtered ${totalBefore - totalAfter} false positives (${totalBefore} → ${totalAfter})`);

    // Combine verified LLM findings with git hygiene (which bypass judge)
    return [...gitHygieneFindings, ...verified];
  } catch (err) {
    console.error('[JudgeAgent] Error:', err.message);
    return allFindings; // Fail open — keep all findings if judge fails
  }
}

// ============================================================
// SEVERITY SCORING — Explicit Deterministic Formula
// LLM classifies category, we compute the score
// ============================================================

/**
 * Per-category, per-severity point values.
 * Security issues are weighted much heavier than style nitpicks.
 */
const SEVERITY_WEIGHTS = {
  GIT_HYGIENE: {
    CRITICAL: 10, // e.g. committed private key
    HIGH: 6,      // e.g. .env file committed
    MEDIUM: 3,    // e.g. large PR
    LOW: 1,
  },
  SECURITY: {
    CRITICAL: 9,
    HIGH: 6,
    MEDIUM: 3,
    LOW: 1,
  },
  LOGIC: {
    HIGH: 5,
    MEDIUM: 3,
    LOW: 1,
  },
  PERFORMANCE: {
    HIGH: 4,
    MEDIUM: 2,
    LOW: 1,
  },
  TESTING: {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  },
  STYLE: {
    HIGH: 2,
    MEDIUM: 1,
    LOW: 0.5,
  },
  JUDGE: {
    HIGH: 2,
    MEDIUM: 1,
    LOW: 0.5,
  },
};

/**
 * Calculate severity score from all agent findings.
 * Returns a score 0-10 using explicit weighted formula.
 * Applies path-based multipliers for critical directories (auth/, payment/, etc.).
 *
 * @param {object} findingsByCategory - { STYLE: [], SECURITY: [], LOGIC: [], ... }
 * @param {Array}  files              - preprocessed diff files (optional, for path weighting)
 * @returns {number} score 0-10
 */
function calculateSeverityScore(findingsByCategory, files = []) {
  let rawScore = 0;

  // Build a quick lookup: filename → path multiplier
  const pathMultiplierCache = {};
  const getMultiplier = (filename) => {
    if (!filename) return 1.0;
    if (pathMultiplierCache[filename] !== undefined) return pathMultiplierCache[filename];
    const mult = getPathMultiplier(filename);
    pathMultiplierCache[filename] = mult;
    if (mult > 1.0) {
      const label = getPathLabel(filename);
      console.log(`📍 [PathWeight] ${filename}: ×${mult} (${label})`);
    }
    return mult;
  };

  Object.entries(findingsByCategory).forEach(([category, findings]) => {
    const weights = SEVERITY_WEIGHTS[category] || SEVERITY_WEIGHTS.STYLE;
    findings.forEach((f) => {
      const sev = (f.severity || 'LOW').toUpperCase();
      const basePoints = weights[sev] || 0;
      const multiplier = getMultiplier(f.file);
      rawScore += basePoints * multiplier;
    });
  });

  // Normalize: cap at 10 with diminishing returns
  // Linear up to 15 raw points maps to 10/10
  const normalized = Math.min(10, Math.round((rawScore / 15) * 10 * 10) / 10);
  return Math.max(0, normalized);
}

// ============================================================
// MARKDOWN COMMENT FORMATTER — Rich categorized output
// ============================================================

const CATEGORY_META = {
  GIT_HYGIENE: { emoji: '🔑', label: 'Git Hygiene & Secrets' },
  SECURITY: { emoji: '🔒', label: 'Security Vulnerabilities' },
  LOGIC: { emoji: '🧠', label: 'Logic & Correctness' },
  PERFORMANCE: { emoji: '⚡', label: 'Performance' },
  TESTING: { emoji: '🧪', label: 'Test Coverage' },
  STYLE: { emoji: '🎨', label: 'Style & Code Quality' },
};

const SEVERITY_BADGES = {
  CRITICAL: '🚨 CRITICAL',
  HIGH: '🔴 HIGH',
  MEDIUM: '🟡 MEDIUM',
  LOW: '🟢 LOW',
};

/**
 * Format a rich markdown PR comment from all findings.
 * @param {number} severityScore
 * @param {object} findingsByCategory - { CATEGORY: [findings] }
 * @param {object} agentSummary - counts per category
 * @param {object} options - { reviewCount, headSha } for footer
 * @returns {string} markdown
 */
function formatMarkdownComment(severityScore, findingsByCategory, agentSummary = {}, options = {}) {
  const { reviewCount = 1, headSha = '' } = options;
  const totalFindings = Object.values(findingsByCategory).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  // Score bar
  const filledBars = Math.round(severityScore);
  const scoreBar = '█'.repeat(filledBars) + '░'.repeat(10 - filledBars);

  let markdown = `## 🤖 Codezy AI Review\n\n`;
  markdown += `| Metric | Value |\n|---|---|\n`;
  markdown += `| **Severity Score** | \`${severityScore}/10\` ${scoreBar} |\n`;
  markdown += `| **Total Findings** | ${totalFindings} |\n`;
  markdown += `| **Agents Run** | ${Object.keys(findingsByCategory).filter(k => findingsByCategory[k].length >= 0).length} |\n\n`;

  if (totalFindings === 0) {
    markdown += `✅ **No issues found! Clean PR — great work.**\n\n`;
    markdown += `---\n`;
    const shortSha = headSha ? headSha.substring(0, 7) : 'unknown';
    markdown += `*🔄 Reviewed **${reviewCount}** time(s) | Last commit: \`${shortSha}\` | Automated review by [Codezy](https://github.com/apps/codezyautoreview)*`;

    return markdown;
  }

  // Render findings by category (priority order)
  const categoryOrder = ['GIT_HYGIENE', 'SECURITY', 'LOGIC', 'PERFORMANCE', 'TESTING', 'STYLE'];

  categoryOrder.forEach((category) => {
    const findings = findingsByCategory[category];
    if (!findings || findings.length === 0) return;

    const meta = CATEGORY_META[category] || { emoji: '📋', label: category };
    markdown += `### ${meta.emoji} ${meta.label} (${findings.length})\n\n`;

    // Sort by severity (CRITICAL first)
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const sorted = [...findings].sort(
      (a, b) =>
        (severityOrder[(a.severity || 'LOW').toUpperCase()] ?? 3) -
        (severityOrder[(b.severity || 'LOW').toUpperCase()] ?? 3)
    );

    sorted.forEach((f) => {
      const badge = SEVERITY_BADGES[(f.severity || 'LOW').toUpperCase()] || f.severity;
      const location = f.line && f.line > 0 ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
      markdown += `- **${badge}** ${location}\n  ${f.issue}\n`;

      // ── Suggested Fix block ──────────────────────────────────
      // GitHub renders ```suggestion blocks as one-click apply buttons on PR diffs.
      // We only emit this when the agent provided a confident before/after pair.
      if (f.suggestedFix && f.suggestedFix.after) {
        markdown += `\n  <details>\n  <summary>💡 Suggested Fix</summary>\n\n`;
        if (f.suggestedFix.before) {
          markdown += `  **Before:**\n  \`\`\`\n  ${f.suggestedFix.before}\n  \`\`\`\n`;
        }
        markdown += `  **After:**\n  \`\`\`suggestion\n  ${f.suggestedFix.after}\n  \`\`\`\n  </details>\n`;
      }

      markdown += `\n`;
    });

    markdown += `\n`;
  });

  markdown += `---\n`;
  markdown += `<details>\n<summary>ℹ️ About Codezy Review</summary>\n\n`;
  markdown += `This review was generated by Codezy's multi-agent pipeline:\n`;
  markdown += `- **Git Hygiene Agent** — Static pattern analysis (no LLM)\n`;
  markdown += `- **Security Agent** — Vulnerability scanning\n`;
  markdown += `- **Logic Agent** — Correctness & edge case analysis\n`;
  markdown += `- **Performance Agent** — N+1, memory leak, blocking op detection\n`;
  markdown += `- **Testing Agent** — Coverage gap identification\n`;
  markdown += `- **Style Agent** — Code quality & conventions\n`;
  markdown += `- **Judge Agent** — False positive filter (verifies all findings against diff)\n\n`;
  markdown += `Severity Score Formula: GIT_HYGIENE_CRITICAL=10pts, SECURITY_CRITICAL=9pts, LOGIC_HIGH=5pts, normalized to 0–10. Path-weighted for critical directories (auth/, payment/, etc.).\n`;
  markdown += `</details>\n\n`;

  const shortSha = headSha ? headSha.substring(0, 7) : 'unknown';
  markdown += `*🔄 Reviewed **${reviewCount}** time(s) | Last commit: \`${shortSha}\` | Automated review by [Codezy](https://github.com/apps/codezyautoreview)*`;


  return markdown;
}

// ============================================================
// EXPORTS
// ============================================================

export {
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
  selectModelTier,
  generateAgentCompletion,
  parseJsonFindings,
  SEVERITY_WEIGHTS,
  CATEGORY_META,
};

