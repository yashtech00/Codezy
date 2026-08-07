import * as jsyaml from 'js-yaml';
const yaml = jsyaml.default || jsyaml;

export const DEFAULT_REPO_CONFIG = {
  version: '2.0',
  review: {
    max_comments: 8,
    minimum_coverage: 50,
    suppress_minor_findings: false,
    paths: {
      'src/controllers/**': {
        focus: ['SECURITY_PRIVACY', 'FUNCTIONAL_CORRECTNESS'],
      },
      'src/services/**': {
        focus: ['FUNCTIONAL_CORRECTNESS', 'RELIABILITY', 'DATA_INTEGRITY'],
      },
      'prisma/**': {
        focus: ['DATA_INTEGRITY', 'PERFORMANCE'],
      },
    },
  },
  policy: {
    block: {
      verified_critical: true,
      verified_high_security: true,
      minimum_confidence: 0.8,
    },
  },
};

/**
 * Parses raw .codereview.yml or REVIEW.md content from target repository into structured config.
 */
export function parseRepoConfig(rawConfigString = '') {
  if (!rawConfigString || typeof rawConfigString !== 'string') {
    return DEFAULT_REPO_CONFIG;
  }

  try {
    const parsed = yaml.load(rawConfigString);
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_REPO_CONFIG;
    }

    return {
      version: parsed.version || DEFAULT_REPO_CONFIG.version,
      review: {
        ...DEFAULT_REPO_CONFIG.review,
        ...(parsed.review || {}),
      },
      policy: {
        ...DEFAULT_REPO_CONFIG.policy,
        ...(parsed.policy || {}),
      },
    };
  } catch (err) {
    return DEFAULT_REPO_CONFIG;
  }
}

/**
 * Resolves path-specific review instructions for a given file.
 */
export function getPathInstructions(filename = '', repoConfig = DEFAULT_REPO_CONFIG) {
  const paths = repoConfig?.review?.paths || {};
  
  for (const [globPattern, config] of Object.entries(paths)) {
    const prefix = globPattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
    if (filename.startsWith(prefix) || globPattern === '*') {
      return config;
    }
  }

  return null;
}
