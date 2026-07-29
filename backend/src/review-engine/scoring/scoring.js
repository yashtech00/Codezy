/**
 * Level 2 Risk & Quality Scoring Engine
 * Computes individual finding risk weights and aggregated PR risk with diminishing returns.
 */

const BASE_SEVERITY_WEIGHTS = {
  CRITICAL: 10,
  HIGH: 6,
  MEDIUM: 3,
  LOW: 1,
};

const VERIFICATION_FACTORS = {
  VERIFIED: 1.0,
  LIKELY: 0.75,
  UNVERIFIED: 0.35,
  REJECTED: 0.0,
};

export const calculateFindingRisk = (finding) => {
  const B = BASE_SEVERITY_WEIGHTS[finding.severity] || 1;
  const V = VERIFICATION_FACTORS[finding.verificationStatus] || 0.75;
  const C = finding.adjustedConfidence || finding.confidence || 0.8;
  const I = finding.introducedByPr !== false ? 1.0 : 0.5;

  return B * V * C * I;
};

export const computePRMetrics = (verifiedFindings = [], reviewCoverage = 100) => {
  let totalRawRisk = 0;
  let blockingCount = 0;
  let warningCount = 0;
  let suggestionCount = 0;

  for (const finding of verifiedFindings) {
    const rawRisk = calculateFindingRisk(finding);
    totalRawRisk += rawRisk;

    if (finding.blockingEligible || (finding.verificationStatus === 'VERIFIED' && ['CRITICAL', 'HIGH'].includes(finding.severity))) {
      blockingCount++;
    } else if (finding.severity === 'MEDIUM') {
      warningCount++;
    } else {
      suggestionCount++;
    }
  }

  // Diminishing returns formula: 10 * (1 - e^(-Sum(R_i) / 15))
  const K = 15;
  const riskScore = Number((10 * (1 - Math.exp(-totalRawRisk / K))).toFixed(2));
  const qualityScore = Number(Math.max(0, 100 - riskScore * 10).toFixed(2));

  // Compute overall review confidence from individual finding confidences
  const avgConfidence = verifiedFindings.length > 0
    ? verifiedFindings.reduce((acc, f) => acc + (f.adjustedConfidence || f.confidence || 0.8), 0) / verifiedFindings.length
    : 0.95;

  const reviewConfidence = Number((avgConfidence * 100).toFixed(2));

  return {
    riskScore,
    qualityScore,
    reviewConfidence,
    reviewCoverage,
    blockingCount,
    warningCount,
    suggestionCount,
    totalRawRisk,
  };
};
