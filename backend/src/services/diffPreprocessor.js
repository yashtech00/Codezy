/**
 * Diff Preprocessor — Cleans, filters, and enriches PR diff files
 * for downstream agent consumption.
 */

const IGNORED_EXTENSIONS = [
  '.lock', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.pdf', '.zip', '.gz', '.tgz', '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp3', '.mp4', '.webm',
  '.webp', '.avif',
];

const IGNORED_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
];

function shouldSkipFile(filename) {
  if (IGNORED_FILES.includes(filename.split('/').pop())) return true;
  return IGNORED_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

/**
 * Parse unified diff patch into structured hunks.
 * Returns array of { startLine, lines[] } objects.
 * @param {string} patch
 * @returns {Array<{startLine: number, lines: string[]}>}
 */
function parsePatchHunks(patch) {
  if (!patch) return [];
  const hunks = [];
  let currentHunk = null;
  let lineCounter = 0;

  for (const line of patch.split('\n')) {
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkHeader) {
      if (currentHunk) hunks.push(currentHunk);
      lineCounter = parseInt(hunkHeader[1], 10);
      currentHunk = { startLine: lineCounter, lines: [] };
    } else if (currentHunk) {
      currentHunk.lines.push({ raw: line, lineNumber: lineCounter });
      if (!line.startsWith('-')) lineCounter++;
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

/**
 * Expand diff context: for small diffs, include surrounding lines
 * so agents have more context. This mimics CodeRabbit's context build.
 *
 * For each hunk, we annotate the patch with line numbers from the
 * new file perspective, making it easier for the LLM to reference lines.
 *
 * @param {string} patch - raw unified diff patch
 * @param {number} contextLines - how many surrounding lines to note
 * @returns {string} annotated patch with line numbers
 */
function expandDiffContext(patch) {
  if (!patch) return '';
  const lines = patch.split('\n');
  const annotated = [];
  let newLineNum = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkHeader) {
      newLineNum = parseInt(hunkHeader[1], 10) - 1;
      annotated.push(line);
    } else if (line.startsWith('+')) {
      newLineNum++;
      annotated.push(`L${newLineNum}+ ${line.slice(1)}`);
    } else if (line.startsWith('-')) {
      annotated.push(`    - ${line.slice(1)}`);
    } else {
      newLineNum++;
      annotated.push(`L${newLineNum}  ${line.slice(1) || ''}`);
    }
  }

  return annotated.join('\n');
}

/**
 * Determine the category of a file for prioritization.
 * @param {string} filename
 * @returns {string}
 */
function classifyFile(filename) {
  if (filename.match(/\.(test|spec)\.(js|ts|jsx|tsx|py|rb|go)$/)) return 'TEST';
  if (filename.match(/\.(env|pem|key|secret)$/)) return 'SENSITIVE';
  if (filename.match(/\.(yml|yaml|json|toml|ini|conf|config)$/)) return 'CONFIG';
  if (filename.match(/\.(md|txt|rst|docs?)$/i)) return 'DOCS';
  if (filename.match(/schema\.(prisma|sql|graphql)$/)) return 'SCHEMA';
  if (filename.match(/migration/i)) return 'MIGRATION';
  if (filename.match(/route|controller|handler/i)) return 'ROUTE';
  if (filename.match(/service|repository|store/i)) return 'SERVICE';
  if (filename.match(/agent|worker|queue/i)) return 'WORKER';
  return 'CODE';
}

/**
 * Main preprocessor: filter, truncate, annotate, and enrich diff files.
 * @param {Array} files - raw GitHub API files array
 * @returns {Array} processed files
 */
function preprocessDiff(files) {
  if (!Array.isArray(files)) return [];

  const processedFiles = [];

  for (const file of files) {
    if (shouldSkipFile(file.filename)) {
      continue;
    }

    let patch = file.patch || '';
    const lines = patch.split('\n');
    let truncated = false;

    // Truncate very large diffs to avoid token overload
    if (lines.length > 500) {
      patch = lines.slice(0, 500).join('\n') + '\n... [Diff truncated at 500 lines for token efficiency]';
      truncated = true;
    }

    // Annotate patch with line numbers for better LLM referencing
    const annotatedPatch = expandDiffContext(patch);

    const fileCategory = classifyFile(file.filename);

    processedFiles.push({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch, // original patch (for git hygiene static analysis)
      annotatedPatch, // line-number annotated (for LLM agents)
      truncated,
      fileCategory,
    });
  }

  return processedFiles;
}

/**
 * Calculate overall diff statistics.
 * @param {Array} files - processed files
 * @returns {object} stats
 */
function calculateDiffStats(files) {
  const totalFiles = files.length;
  let totalAdditions = 0;
  let totalDeletions = 0;

  const fileCategories = {};

  files.forEach((f) => {
    totalAdditions += f.additions || 0;
    totalDeletions += f.deletions || 0;
    const cat = f.fileCategory || 'CODE';
    fileCategories[cat] = (fileCategories[cat] || 0) + 1;
  });

  return {
    totalFiles,
    totalAdditions,
    totalDeletions,
    totalLinesChanged: totalAdditions + totalDeletions,
    fileCategories, // breakdown by file type
    hasTestFiles: (fileCategories['TEST'] || 0) > 0,
    hasSensitiveFiles: (fileCategories['SENSITIVE'] || 0) > 0,
    hasSchemaChanges: (fileCategories['SCHEMA'] || 0) > 0,
    hasMigrations: (fileCategories['MIGRATION'] || 0) > 0,
  };
}

module.exports = {
  shouldSkipFile,
  preprocessDiff,
  calculateDiffStats,
  expandDiffContext,
  parsePatchHunks,
  classifyFile,
};
