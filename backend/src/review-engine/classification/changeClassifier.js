import { getPathMultiplier } from '../../config/pathWeights.js';

export const CHANGE_TYPES = {
  DOCS: 'DOCS',
  STYLE: 'STYLE',
  UI: 'UI',
  BUSINESS_LOGIC: 'BUSINESS_LOGIC',
  API: 'API',
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  DATABASE: 'DATABASE',
  MIGRATION: 'MIGRATION',
  PAYMENT: 'PAYMENT',
  QUEUE: 'QUEUE',
  CONCURRENCY: 'CONCURRENCY',
  CONFIG: 'CONFIG',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  TEST: 'TEST',
};

const PATH_BASE_RISKS = {
  DOCS: 0,
  STYLE: 1,
  TEST: 1,
  UI: 2,
  CONFIG: 2,
  BUSINESS_LOGIC: 3,
  API: 4,
  DATABASE: 4,
  MIGRATION: 5,
  QUEUE: 4,
  AUTHENTICATION: 5,
  AUTHORIZATION: 5,
  PAYMENT: 5,
  INFRASTRUCTURE: 5,
};

/**
  * Classifies a single file based on filename and patch content.
  */
export function classifyFile(filename = '', patch = '') {
  const lower = filename.toLowerCase();

  if (lower.match(/\.(md|markdown|txt|rst|doc)$/)) return CHANGE_TYPES.DOCS;
  if (lower.match(/\.(css|scss|sass|less)$/)) return CHANGE_TYPES.STYLE;
  if (lower.match(/\.(test|spec)\.(js|ts|jsx|tsx|py)$/) || lower.includes('/tests/')) return CHANGE_TYPES.TEST;
  
  if (lower.includes('auth') || lower.includes('session') || lower.includes('jwt') || lower.includes('token')) {
    return CHANGE_TYPES.AUTHENTICATION;
  }
  if (lower.includes('perm') || lower.includes('role') || lower.includes('policy') || lower.includes('acl')) {
    return CHANGE_TYPES.AUTHORIZATION;
  }
  if (lower.includes('payment') || lower.includes('stripe') || lower.includes('billing') || lower.includes('checkout')) {
    return CHANGE_TYPES.PAYMENT;
  }
  if (lower.includes('prisma') || lower.includes('migration') || lower.includes('schema') || lower.match(/\.(sql)$/)) {
    return CHANGE_TYPES.MIGRATION;
  }
  if (lower.includes('route') || lower.includes('controller') || lower.includes('endpoint') || lower.includes('api')) {
    return CHANGE_TYPES.API;
  }
  if (lower.includes('queue') || lower.includes('worker') || lower.includes('job')) {
    return CHANGE_TYPES.QUEUE;
  }
  if (lower.match(/\.(jsx|tsx|vue|svelte)$/) || lower.includes('/components/')) {
    return CHANGE_TYPES.UI;
  }
  if (lower.match(/\.(json|yml|yaml|toml|ini|env\.example)$/) || lower.includes('docker') || lower.includes('.github/')) {
    return CHANGE_TYPES.CONFIG;
  }

  return CHANGE_TYPES.BUSINESS_LOGIC;
}

/**
 * Classifies an entire PR push diff and calculates risk score & pillar selection.
 */
export function classifyPushChanges(files = [], stats = { totalLinesChanged: 0, totalFiles: 0 }) {
  if (!files || files.length === 0) {
    return {
      changeTypes: [CHANGE_TYPES.DOCS],
      baseRiskScore: 0,
      pillars: [],
      route: 'SKIP',
      reason: 'No files in diff',
    };
  }

  const changeTypesSet = new Set();
  let maxBaseRisk = 0;
  let hasCriticalPath = false;

  for (const file of files) {
    const type = classifyFile(file.filename, file.patch);
    changeTypesSet.add(type);
    
    const risk = PATH_BASE_RISKS[type] || 2;
    if (risk > maxBaseRisk) maxBaseRisk = risk;

    const pathMultiplier = getPathMultiplier(file.filename);
    if (pathMultiplier > 1.2) {
      hasCriticalPath = true;
    }
  }

  const changeTypes = Array.from(changeTypesSet);

  // Skip docs-only changes
  if (changeTypes.length === 1 && changeTypes[0] === CHANGE_TYPES.DOCS) {
    return {
      changeTypes,
      baseRiskScore: 0,
      pillars: [],
      route: 'SKIP',
      reason: 'Only documentation changed',
    };
  }

  // Config-only changes
  if (changeTypes.length === 1 && (changeTypes[0] === CHANGE_TYPES.CONFIG || changeTypes[0] === CHANGE_TYPES.STYLE)) {
    return {
      changeTypes,
      baseRiskScore: 1,
      pillars: ['OBSERVABILITY', 'ARCHITECTURE'],
      route: 'DETERMINISTIC_ONLY',
      reason: 'Config or style files only',
    };
  }

  // Calculate overall risk score
  let riskScore = maxBaseRisk;
  if (hasCriticalPath) riskScore += 2;
  if (stats.totalLinesChanged > 300) riskScore += 1;
  if (changeTypes.includes(CHANGE_TYPES.AUTHENTICATION) || changeTypes.includes(CHANGE_TYPES.PAYMENT)) riskScore += 2;
  
  riskScore = Math.min(10, riskScore);

  // Select relevant review pillars based on active change types
  const pillarsSet = new Set(['FUNCTIONAL_CORRECTNESS']); // Always evaluate functional correctness for code

  if (changeTypes.includes(CHANGE_TYPES.AUTHENTICATION) || changeTypes.includes(CHANGE_TYPES.AUTHORIZATION) || changeTypes.includes(CHANGE_TYPES.API) || changeTypes.includes(CHANGE_TYPES.PAYMENT)) {
    pillarsSet.add('SECURITY_PRIVACY');
  }

  if (changeTypes.includes(CHANGE_TYPES.DATABASE) || changeTypes.includes(CHANGE_TYPES.MIGRATION) || changeTypes.includes(CHANGE_TYPES.API)) {
    pillarsSet.add('DATA_INTEGRITY');
  }

  if (changeTypes.includes(CHANGE_TYPES.QUEUE) || changeTypes.includes(CHANGE_TYPES.BUSINESS_LOGIC) || changeTypes.includes(CHANGE_TYPES.PAYMENT)) {
    pillarsSet.add('RELIABILITY');
  }

  if (changeTypes.includes(CHANGE_TYPES.DATABASE) || changeTypes.includes(CHANGE_TYPES.QUEUE) || stats.totalLinesChanged > 100) {
    pillarsSet.add('PERFORMANCE');
  }

  if (changeTypes.includes(CHANGE_TYPES.BUSINESS_LOGIC) || changeTypes.includes(CHANGE_TYPES.API)) {
    pillarsSet.add('ARCHITECTURE');
    pillarsSet.add('TESTING');
  }

  if (changeTypes.includes(CHANGE_TYPES.QUEUE) || changeTypes.includes(CHANGE_TYPES.API) || changeTypes.includes(CHANGE_TYPES.CONFIG)) {
    pillarsSet.add('OBSERVABILITY');
  }

  const pillars = Array.from(pillarsSet);

  // Determine model routing
  let route = 'CHEAP';
  if (riskScore >= 6 || stats.totalLinesChanged >= 150 || hasCriticalPath) {
    route = 'POWERFUL_PLUS_VERIFIER';
  } else if (riskScore >= 3 || stats.totalLinesChanged >= 50) {
    route = 'POWERFUL';
  }

  return {
    changeTypes,
    baseRiskScore: riskScore,
    pillars,
    route,
    hasCriticalPath,
  };
}
