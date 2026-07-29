/**
 * repoConfig.service.js
 * Fetches and parses .codezy.yaml from the target GitHub repo.
 * Falls back to a default config (all agents enabled) if the file doesn't exist.
 *
 * .codezy.yaml schema:
 * ---
 * commentTypes:
 *   - security
 *   - style
 *   - logic
 *   - performance
 *   - testing
 *   - git_hygiene
 *
 * Any subset of the above enables only those agent categories.
 * If the file is absent or malformed, ALL types are enabled by default.
 */

import * as yaml from 'js-yaml';
import { getOctokit } from './github.service.js';

// ────────────────────────────────────────────────────────────
// DEFAULT CONFIG — all agents enabled
// ────────────────────────────────────────────────────────────
const DEFAULT_REPO_CONFIG = {
  commentTypes: ['security', 'style', 'logic', 'performance', 'testing', 'git_hygiene'],
};

/**
 * Valid comment type values and their corresponding agent category keys.
 * Maps lowercase .codezy.yaml keys → uppercase internal category names.
 */
const VALID_COMMENT_TYPES = {
  security: 'SECURITY',
  style: 'STYLE',
  logic: 'LOGIC',
  performance: 'PERFORMANCE',
  testing: 'TESTING',
  git_hygiene: 'GIT_HYGIENE',
};

/**
 * Fetch and parse .codezy.yaml from the repo root via GitHub API.
 *
 * @param {string} owner - GitHub repo owner
 * @param {string} repo  - GitHub repo name
 * @param {number|null} installationId - GitHub App installation ID
 * @returns {Promise<object>} Parsed config object (or default if absent/invalid)
 */
async function fetchRepoConfig(owner, repo, installationId) {
  try {
    const octokit = getOctokit(installationId);
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: '.codezy.yaml',
    });

    // File content is base64 encoded by GitHub API
    const raw = Buffer.from(data.content, 'base64').toString('utf8');
    const parsed = yaml.load(raw);

    if (!parsed || typeof parsed !== 'object') {
      console.warn('[RepoConfig] .codezy.yaml parsed to empty/invalid object — using defaults');
      return DEFAULT_REPO_CONFIG;
    }

    // Validate commentTypes array
    const rawTypes = parsed.commentTypes;
    if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
      console.warn('[RepoConfig] .codezy.yaml has no valid commentTypes array — enabling all agents');
      return DEFAULT_REPO_CONFIG;
    }

    // Filter only known valid types, convert to uppercase internal keys
    const validTypes = rawTypes
      .map((t) => (typeof t === 'string' ? t.toLowerCase().trim() : ''))
      .filter((t) => VALID_COMMENT_TYPES[t]);

    if (validTypes.length === 0) {
      console.warn('[RepoConfig] .codezy.yaml commentTypes contains no recognized values — enabling all agents');
      return DEFAULT_REPO_CONFIG;
    }

    const config = {
      ...DEFAULT_REPO_CONFIG,
      ...parsed,
      commentTypes: validTypes,
    };

    console.log(`✅ [RepoConfig] Loaded .codezy.yaml for ${owner}/${repo}: commentTypes=[${validTypes.join(', ')}]`);
    return config;
  } catch (err) {
    if (err.status === 404) {
      console.log(`ℹ️ [RepoConfig] No .codezy.yaml found in ${owner}/${repo} — using default config (all agents enabled)`);
    } else {
      console.error(`⚠️ [RepoConfig] Failed to fetch .codezy.yaml:`, err.message);
    }
    return DEFAULT_REPO_CONFIG;
  }
}

/**
 * Convert validated commentTypes array to a Set of uppercase internal category keys.
 * Used for O(1) lookup in worker.
 *
 * @param {object} repoConfig - parsed config (or default)
 * @returns {Set<string>} e.g. Set { 'SECURITY', 'STYLE', 'GIT_HYGIENE' }
 */
function getEnabledCategories(repoConfig) {
  const types = repoConfig?.commentTypes || DEFAULT_REPO_CONFIG.commentTypes;
  const ALL_VALID_CATEGORIES = new Set(Object.values(VALID_COMMENT_TYPES));

  const resolved = new Set(
    types
      .map((t) => VALID_COMMENT_TYPES[typeof t === 'string' ? t.toLowerCase().trim() : ''])
      .filter(Boolean) // only recognized internal keys get through
  );

  // If all provided types were unknown/unrecognized, fall back to all enabled
  // to avoid silently disabling all agents
  if (resolved.size === 0) {
    console.warn('[RepoConfig] getEnabledCategories: no recognized types — enabling all agents');
    return new Set(ALL_VALID_CATEGORIES);
  }

  return resolved;
}

export {
  fetchRepoConfig,
  getEnabledCategories,
  DEFAULT_REPO_CONFIG,
  VALID_COMMENT_TYPES,
};

