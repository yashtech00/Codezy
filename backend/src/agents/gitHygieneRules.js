/**
 * Git Hygiene Rules — Static Pattern-Based Analysis
 * No LLM needed. Fast, deterministic, zero API cost.
 * Detects sensitive files, hardcoded secrets, debug artifacts.
 */

// Files that should NEVER be committed
const SENSITIVE_FILENAMES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.development',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  'id_rsa',
  'id_ed25519',
  'known_hosts',
];

const SENSITIVE_FILENAME_PATTERNS = [
  /^\.env(\.|$)/i,                    // .env, .env.local, .env.example (if contains real values)
  /\.pem$/i,                           // SSL/TLS private keys
  /\.p12$/i,                           // PKCS12 keystores
  /\.pfx$/i,                           // Personal Information Exchange
  /\.key$/i,                           // Private key files
  /\.keystore$/i,                      // Java keystores
  /^node_modules\//,                   // node_modules directory
  /\.DS_Store$/,                       // macOS metadata
  /Thumbs\.db$/i,                      // Windows thumbnails
  /\.log$/,                            // Log files (may contain sensitive data)
  /^dist\//,                           // Build output
  /^build\//,                          // Build output
  /^\.next\//,                         // Next.js build
  /^coverage\//,                       // Test coverage output
];

// Patterns in file CONTENT that indicate secrets or security issues
const SECRET_PATTERNS = [
  {
    pattern: /(['"`])(sk-[a-zA-Z0-9]{20,})\1/g,
    issue: 'Hardcoded OpenAI API key detected (sk-...)',
    severity: 'CRITICAL',
    category: 'secret',
  },
  {
    pattern: /(['"`])(AIzaSy[a-zA-Z0-9_-]{20,})\1/g,
    issue: 'Hardcoded Google/Gemini API key detected (AIzaSy...)',
    severity: 'CRITICAL',
    category: 'secret',
  },
  {
    pattern: /(['"`])(ghp_[a-zA-Z0-9]{36})\1/g,
    issue: 'Hardcoded GitHub Personal Access Token detected (ghp_...)',
    severity: 'CRITICAL',
    category: 'secret',
  },
  {
    pattern: /(['"`])(github_pat_[a-zA-Z0-9_]{82})\1/g,
    issue: 'Hardcoded GitHub Fine-Grained PAT detected',
    severity: 'CRITICAL',
    category: 'secret',
  },
  {
    pattern: /(['"`])(AKIA[A-Z0-9]{16})\1/g,
    issue: 'Hardcoded AWS Access Key ID detected (AKIA...)',
    severity: 'CRITICAL',
    category: 'secret',
  },
  {
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    issue: 'Private key content detected in source code',
    severity: 'CRITICAL',
    category: 'secret',
  },
  {
    pattern: /(['"`])(eyJ[a-zA-Z0-9_-]{50,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})\1/g,
    issue: 'Hardcoded JWT token detected in source code',
    severity: 'HIGH',
    category: 'secret',
  },
  {
    pattern: /password\s*[:=]\s*(['"`])[^'"`\s]{8,}\1/gi,
    issue: 'Hardcoded password string detected',
    severity: 'HIGH',
    category: 'secret',
  },
  {
    pattern: /secret\s*[:=]\s*(['"`])[^'"`\s]{8,}\1/gi,
    issue: 'Hardcoded secret value detected',
    severity: 'HIGH',
    category: 'secret',
  },
];

// Debug/quality patterns in patch content
const DEBUG_PATTERNS = [
  {
    pattern: /^\+.*\bconsole\.(log|debug|warn|info)\s*\(/m,
    issue: 'console.log/debug statement found — should be removed before production merge',
    severity: 'LOW',
    category: 'debug',
  },
  {
    pattern: /^\+.*\bdebugger\s*;/m,
    issue: 'debugger statement found — must be removed before merge',
    severity: 'MEDIUM',
    category: 'debug',
  },
  {
    pattern: /^\+.*\/\/\s*(TODO|FIXME|HACK|XXX|BUG)\s*:/im,
    issue: 'TODO/FIXME marker found — verify this is intentional and tracked',
    severity: 'LOW',
    category: 'quality',
  },
];

// PR-level checks (not per file)
const PR_LEVEL_CHECKS = {
  LARGE_PR_THRESHOLD: 500, // lines changed
  SENSITIVE_ENV_VAR_PATTERN: /process\.env\.[A-Z_]+/g,
};

/**
 * Analyze a single file for Git Hygiene issues.
 * @param {object} file - Preprocessed file object from diffPreprocessor
 * @returns {Array} findings
 */
function analyzeFileHygiene(file) {
  const findings = [];
  const filename = file.filename;
  const patch = file.patch || '';

  // 1. Check if this is a sensitive filename
  const isSensitiveFilename = SENSITIVE_FILENAMES.some(f =>
    filename === f || filename.endsWith('/' + f)
  );
  const matchesSensitivePattern = SENSITIVE_FILENAME_PATTERNS.some(p =>
    p.test(filename)
  );

  if (isSensitiveFilename || matchesSensitivePattern) {
    findings.push({
      file: filename,
      line: 1,
      issue: `Sensitive file "${filename}" should not be committed. Add it to .gitignore.`,
      severity: filename.includes('.env') || filename.endsWith('.pem') || filename.endsWith('.key') ? 'CRITICAL' : 'HIGH',
      category: 'GIT_HYGIENE',
      ruleId: 'SENSITIVE_FILE',
    });
  }

  // 2. Check patch content for secrets
  const patchLines = patch.split('\n');
  SECRET_PATTERNS.forEach(({ pattern, issue, severity, category }) => {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    // Only check added lines (lines starting with +)
    patchLines.forEach((line, lineIdx) => {
      if (!line.startsWith('+')) return; // Skip removed and context lines
      // Reset lastIndex for each line
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({
          file: filename,
          line: lineIdx + 1,
          issue,
          severity,
          category: 'GIT_HYGIENE',
          ruleId: `SECRET_${category.toUpperCase()}`,
        });
      }
    });
  });

  // 3. Check for debug patterns
  DEBUG_PATTERNS.forEach(({ pattern, issue, severity }) => {
    // For multiline patterns, test against full patch
    if (pattern.test(patch)) {
      // Find the specific line
      const lineMatch = patch.split('\n').findIndex(l => {
        const singleLinePattern = new RegExp(pattern.source.replace(/^\^/, '').replace(/\/m$/, ''));
        return l.startsWith('+') && singleLinePattern.test(l);
      });
      findings.push({
        file: filename,
        line: Math.max(1, lineMatch),
        issue,
        severity,
        category: 'GIT_HYGIENE',
        ruleId: 'DEBUG_CODE',
      });
    }
  });

  return findings;
}

/**
 * PR-level hygiene checks (checks the whole PR, not individual files)
 * @param {Array} files - All processed files
 * @param {object} stats - Diff stats
 * @returns {Array} findings
 */
function analyzePRLevelHygiene(files, stats) {
  const findings = [];

  // 1. Large PR warning
  if (stats.totalLinesChanged > PR_LEVEL_CHECKS.LARGE_PR_THRESHOLD) {
    findings.push({
      file: 'PR',
      line: 0,
      issue: `Large PR detected (${stats.totalLinesChanged} lines changed). Consider splitting into smaller, focused PRs for easier review.`,
      severity: 'MEDIUM',
      category: 'GIT_HYGIENE',
      ruleId: 'LARGE_PR',
    });
  }

  // 2. node_modules or dist accidentally included
  const builtFiles = files.filter(f =>
    f.filename.startsWith('node_modules/') ||
    f.filename.startsWith('dist/') ||
    f.filename.startsWith('build/') ||
    f.filename.startsWith('.next/')
  );
  if (builtFiles.length > 0) {
    findings.push({
      file: builtFiles[0].filename,
      line: 1,
      issue: `Build artifact or dependency directory "${builtFiles[0].filename}" found in PR. These should be in .gitignore.`,
      severity: 'HIGH',
      category: 'GIT_HYGIENE',
      ruleId: 'BUILD_ARTIFACT',
    });
  }

  return findings;
}

/**
 * Run the full Git Hygiene analysis on all files.
 * @param {Array} files - Preprocessed files array
 * @param {object} stats - Diff stats
 * @returns {Array} all findings
 */
function runGitHygieneStaticAnalysis(files, stats) {
  let allFindings = [];

  // Per-file analysis
  files.forEach(file => {
    const fileFindings = analyzeFileHygiene(file);
    allFindings = allFindings.concat(fileFindings);
  });

  // PR-level analysis
  const prFindings = analyzePRLevelHygiene(files, stats);
  allFindings = allFindings.concat(prFindings);

  return allFindings;
}

module.exports = {
  runGitHygieneStaticAnalysis,
  analyzeFileHygiene,
  analyzePRLevelHygiene,
  SENSITIVE_FILENAMES,
  SECRET_PATTERNS,
};
