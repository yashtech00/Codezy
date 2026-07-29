import crypto from 'crypto';

/**
 * Normalizes code content for structural matching by trimming extra whitespace,
 * converting variable naming variations where possible, and taking a structural snippet.
 */
export const buildCodeAnchor = (changedCode = '', title = '', startLine = 1) => {
  const normalizedSnippet = changedCode
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, 3)
    .join(' ');

  const anchorRaw = `${title.toLowerCase().trim()}:${normalizedSnippet}`;
  return crypto.createHash('sha1').update(anchorRaw).digest('hex').substring(0, 16);
};

/**
 * Computes a stable finding fingerprint across commits.
 * fingerprint = SHA-256(repositoryId + normalizedFilePath + category + ruleId/rootCause + codeAnchor)
 */
export const generateFingerprint = ({
  repositoryId = 'default_repo',
  filePath,
  category,
  ruleId = '',
  title = '',
  codeAnchor,
}) => {
  const normalizedPath = (filePath || '').trim().replace(/\\/g, '/').toLowerCase();
  const stableRule = (ruleId || title || 'generic_rule').toLowerCase().trim();

  const rawString = [
    repositoryId,
    normalizedPath,
    category.toUpperCase(),
    stableRule,
    codeAnchor,
  ].join('|');

  return crypto.createHash('sha256').update(rawString).digest('hex');
};
