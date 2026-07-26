const IGNORED_EXTENSIONS = [
  '.lock', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.exe', '.dll', '.so', '.dylib'
];

const IGNORED_FILES = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock'
];

function shouldSkipFile(filename) {
  if (IGNORED_FILES.includes(filename)) return true;
  return IGNORED_EXTENSIONS.some(ext => filename.endsWith(ext));
}

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

    if (lines.length > 500) {
      patch = lines.slice(0, 500).join('\n') + '\n... [Diff truncated at 500 lines]';
      truncated = true;
    }

    processedFiles.push({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch,
      truncated,
    });
  }

  return processedFiles;
}

function calculateDiffStats(files) {
  const totalFiles = files.length;
  let totalAdditions = 0;
  let totalDeletions = 0;

  files.forEach(f => {
    totalAdditions += f.additions || 0;
    totalDeletions += f.deletions || 0;
  });

  return {
    totalFiles,
    totalAdditions,
    totalDeletions,
    totalLinesChanged: totalAdditions + totalDeletions,
  };
}

module.exports = {
  shouldSkipFile,
  preprocessDiff,
  calculateDiffStats,
};
