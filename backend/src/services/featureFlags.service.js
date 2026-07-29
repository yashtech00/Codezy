/**
 * Feature Flags Service for Codezy Level 2
 * Enables progressive rollout of Level 2 capabilities.
 */

const DEFAULT_FLAGS = {
  level2_pipeline: true,
  incremental_review: true,
  finding_verification: true,
  inline_comments: true,
  suggested_fixes: true,
  policy_engine_v2: true,
  repository_context: true,
  developer_feedback: true,
  analytics_v2: true,
};

export const getFeatureFlags = (installationId, repositoryId) => {
  // Can be extended to read per-repo overrides from database or env
  const envOverrides = {
    level2_pipeline: process.env.FEATURE_LEVEL2_PIPELINE !== 'false',
    finding_verification: process.env.FEATURE_FINDING_VERIFICATION !== 'false',
    incremental_review: process.env.FEATURE_INCREMENTAL_REVIEW !== 'false',
    inline_comments: process.env.FEATURE_INLINE_COMMENTS !== 'false',
    suggested_fixes: process.env.FEATURE_SUGGESTED_FIXES !== 'false',
    policy_engine_v2: process.env.FEATURE_POLICY_ENGINE_V2 !== 'false',
  };

  return {
    ...DEFAULT_FLAGS,
    ...envOverrides,
  };
};

export const isFeatureEnabled = (flagName, installationId, repositoryId) => {
  const flags = getFeatureFlags(installationId, repositoryId);
  return Boolean(flags[flagName]);
};
