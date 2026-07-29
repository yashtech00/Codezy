/**
 * Policy Engine for Level 2 Merge Decisions
 * Determines PASS, WARNING, ACTION_REQUIRED, or INCOMPLETE based on repository rules.
 */

export const evaluatePolicy = ({
  verifiedFindings = [],
  metrics,
  repoConfig = {},
}) => {
  const matchedRules = [];
  let decision = 'PASS';

  const blockPolicy = repoConfig.policy?.block || {
    verified_critical: true,
    verified_high_security: true,
    minimum_confidence: 0.8,
  };

  // 1. Check for Verified Critical issues
  const criticalFindings = verifiedFindings.filter(
    f => f.severity === 'CRITICAL' && f.verificationStatus === 'VERIFIED'
  );
  if (criticalFindings.length > 0 && blockPolicy.verified_critical) {
    decision = 'ACTION_REQUIRED';
    matchedRules.push({
      ruleId: 'block.verified_critical',
      result: true,
      findingIds: criticalFindings.map(f => f.findingId || f.fingerprint),
      explanation: `Found ${criticalFindings.length} verified critical finding(s).`,
    });
  }

  // 2. Check for Verified High Security issues
  const highSecurityFindings = verifiedFindings.filter(
    f => f.severity === 'HIGH' && f.category === 'SECURITY' && f.verificationStatus === 'VERIFIED'
  );
  if (highSecurityFindings.length > 0 && blockPolicy.verified_high_security) {
    decision = 'ACTION_REQUIRED';
    matchedRules.push({
      ruleId: 'block.verified_high_security',
      result: true,
      findingIds: highSecurityFindings.map(f => f.findingId || f.fingerprint),
      explanation: `Found ${highSecurityFindings.length} verified high-severity security finding(s).`,
    });
  }

  // 3. Warning evaluation if not action required
  if (decision === 'PASS' && metrics.warningCount > 0) {
    decision = 'WARNING';
    matchedRules.push({
      ruleId: 'warn.medium_findings',
      result: true,
      findingIds: [],
      explanation: `Found ${metrics.warningCount} medium-severity warning finding(s).`,
    });
  }

  // 4. Incomplete evaluation
  if (metrics.reviewCoverage < (repoConfig.review?.minimum_coverage || 50)) {
    decision = 'INCOMPLETE';
    matchedRules.push({
      ruleId: 'review.minimum_coverage',
      result: true,
      findingIds: [],
      explanation: `Review coverage (${metrics.reviewCoverage}%) fell below required minimum.`,
    });
  }

  return {
    decision,
    policyVersion: '2.0',
    matchedRules,
  };
};
