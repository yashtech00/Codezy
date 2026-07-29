import { generateFingerprint, buildCodeAnchor } from './fingerprint.js';

/**
 * Deduplicates candidate findings across multiple agents and static scanners.
 */
export const deduplicateFindings = (candidates, repositoryId = 'default') => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const findingMap = new Map();

  for (const candidate of candidates) {
    const codeAnchor = buildCodeAnchor(
      candidate.evidence?.changedCode || '',
      candidate.title,
      candidate.startLine
    );

    const fingerprint = generateFingerprint({
      repositoryId,
      filePath: candidate.filePath,
      category: candidate.category,
      ruleId: candidate.ruleId,
      title: candidate.title,
      codeAnchor,
    });

    if (findingMap.has(fingerprint)) {
      const existing = findingMap.get(fingerprint);

      // Merge candidate findings: prefer STATIC scanner over AI source
      const isStaticUpgrade = candidate.source === 'STATIC' && existing.source !== 'STATIC';
      const higherConfidence = Math.max(existing.confidence || 0.8, candidate.confidence || 0.8);

      const mergedSourceAgents = Array.from(
        new Set([
          ...(Array.isArray(existing.sourceAgents) ? existing.sourceAgents : [existing.sourceAgent]),
          candidate.sourceAgent,
        ])
      );

      findingMap.set(fingerprint, {
        ...(isStaticUpgrade ? candidate : existing),
        confidence: higherConfidence,
        fingerprint,
        codeAnchor,
        sourceAgents: mergedSourceAgents,
        evidence: {
          changedCode: existing.evidence?.changedCode || candidate.evidence?.changedCode || '',
          relatedContext: [existing.evidence?.relatedContext, candidate.evidence?.relatedContext]
            .filter(Boolean)
            .join('\n---\n'),
          reasoning: `${existing.evidence?.reasoning || ''}\n${candidate.evidence?.reasoning || ''}`.trim(),
        },
      });
    } else {
      findingMap.set(fingerprint, {
        ...candidate,
        fingerprint,
        codeAnchor,
        sourceAgents: [candidate.sourceAgent],
      });
    }
  }

  return Array.from(findingMap.values());
};
