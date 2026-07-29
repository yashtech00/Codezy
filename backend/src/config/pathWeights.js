/**
 * pathWeights.js — Contextual Severity Multipliers
 *
 * Files in security-critical directories get a higher weight multiplier
 * so that the same severity finding scores higher if it's in auth/ vs utils/.
 *
 * Usage:
 *   const { getPathMultiplier } = require('./pathWeights');
 *   const multiplier = getPathMultiplier('src/auth/login.js'); // → 2.0
 */

/**
 * Ordered list of path patterns → severity multipliers.
 * First match wins (most specific first).
 * Multiplier of 1.0 means no adjustment (baseline).
 */
const CRITICAL_PATH_PATTERNS = [
  // Authentication & Authorization — highest risk
  { pattern: /\/(auth|authentication|authorize|oauth|sso|login|logout|session)\//i, multiplier: 2.0, label: 'Auth' },
  // Payments & Billing — highest risk
  { pattern: /\/(payment|billing|stripe|checkout|invoice|subscription|pricing)\//i, multiplier: 2.0, label: 'Payment' },
  // Cryptography & Encryption
  { pattern: /\/(crypto|encrypt|decrypt|hash|cipher|token|jwt|key)\//i, multiplier: 1.8, label: 'Crypto' },
  // Admin panels & superuser routes
  { pattern: /\/(admin|superuser|internal|backoffice)\//i, multiplier: 1.6, label: 'Admin' },
  // Middleware & Guards (request processing layer)
  { pattern: /\/(middleware|guard|interceptor|filter|policy)\//i, multiplier: 1.5, label: 'Middleware' },
  // Database schemas & migrations
  { pattern: /\/(migration|migrations|schema|seeds?)\//i, multiplier: 1.4, label: 'Schema' },
  // API routes & controllers (external surface area)
  { pattern: /\/(route|routes|controller|controllers|handler|handlers)\//i, multiplier: 1.3, label: 'Route' },
  // Configuration files
  { pattern: /\/(config|configs|settings|env)\//i, multiplier: 1.2, label: 'Config' },
  // Security directory (explicit)
  { pattern: /\/(security|secure|sanitize|sanitizer|validation|validator)\//i, multiplier: 1.8, label: 'Security' },
];

/**
 * Get the severity multiplier for a given file path.
 *
 * @param {string} filePath - the file path from the diff (e.g. "src/auth/login.js")
 * @returns {number} multiplier (1.0 = no adjustment, >1.0 = higher weight)
 */
function getPathMultiplier(filePath) {
  if (!filePath) return 1.0;

  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');

  for (const { pattern, multiplier } of CRITICAL_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return multiplier;
    }
  }

  return 1.0; // baseline — no adjustment
}

/**
 * Get the label for a file path's critical category (for debug/logging).
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function getPathLabel(filePath) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  for (const { pattern, label } of CRITICAL_PATH_PATTERNS) {
    if (pattern.test(normalized)) return label;
  }
  return null;
}

module.exports = {
  getPathMultiplier,
  getPathLabel,
  CRITICAL_PATH_PATTERNS,
};
