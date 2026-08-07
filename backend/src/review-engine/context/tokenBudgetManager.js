/**
 * Token Budget Manager & Dynamic Context Compression Strategy
 * PR-Agent inspired cost-optimization module.
 */

export const DEFAULT_BUDGET = {
  TOTAL_INPUT: 24000,
  SYSTEM_PROMPT: 2500,
  DIFF: 10000,
  CONTEXT: 5000,
  REPO_RULES: 2500,
  RESERVE: 4000,
};

/**
 * Fast estimation of token count for string content (~4 chars per token).
 */
export function estimateTokens(text = '') {
  if (typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Progressive Patch Compression Levels:
 * Level 1: Full patch with hunk headers and surrounding function lines.
 * Level 2: Changed hunks only (omitting unchanged context lines).
 * Level 3: Extracted function/class signatures & changed line ranges only.
 * Level 4: File metadata summary only.
 */
export function compressPatch(file = {}, level = 1) {
  const filename = file.filename || 'unknown';
  const patch = file.patch || '';

  if (level === 1) {
    return `### File: ${filename}\n\`\`\`diff\n${patch}\n\`\`\``;
  }

  if (level === 2) {
    // Keep only added (+) and deleted (-) lines plus hunk headers (@@)
    const compressedLines = patch
      .split('\n')
      .filter((line) => line.startsWith('+') || line.startsWith('-') || line.startsWith('@@'))
      .join('\n');
    return `### File: ${filename} (Compressed Hunks)\n\`\`\`diff\n${compressedLines}\n\`\`\``;
  }

  if (level === 3) {
    // Extract signatures & added lines
    const addedLines = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .slice(0, 15)
      .join('\n');
    return `### File: ${filename} (Signatures & Key Additions)\nChanged lines snippet:\n\`\`\`\n${addedLines}\n\`\`\``;
  }

  // Level 4: Metadata summary
  return `### File: ${filename} (Metadata only — ${file.additions || 0} additions, ${file.deletions || 0} deletions)`;
}

/**
 * Fits changed files and patches into an explicit token budget.
 */
export function fitPatchesToBudget(files = [], maxDiffTokens = DEFAULT_BUDGET.DIFF) {
  let usedTokens = 0;
  const fittedPatches = [];

  // Sort files by risk/importance (e.g. src/ or auth/ files first, test files later)
  const sortedFiles = [...files].sort((a, b) => {
    const aVal = a.filename.includes('auth') || a.filename.includes('service') ? 2 : 1;
    const bVal = b.filename.includes('auth') || b.filename.includes('service') ? 2 : 1;
    return bVal - aVal;
  });

  for (const file of sortedFiles) {
    let fittedText = '';
    
    // Try Level 1
    const l1 = compressPatch(file, 1);
    const t1 = estimateTokens(l1);

    if (usedTokens + t1 <= maxDiffTokens) {
      fittedText = l1;
      usedTokens += t1;
    } else {
      // Try Level 2
      const l2 = compressPatch(file, 2);
      const t2 = estimateTokens(l2);

      if (usedTokens + t2 <= maxDiffTokens) {
        fittedText = l2;
        usedTokens += t2;
      } else {
        // Try Level 3
        const l3 = compressPatch(file, 3);
        const t3 = estimateTokens(l3);

        if (usedTokens + t3 <= maxDiffTokens) {
          fittedText = l3;
          usedTokens += t3;
        } else {
          // Fall back to Level 4
          const l4 = compressPatch(file, 4);
          const t4 = estimateTokens(l4);
          fittedText = l4;
          usedTokens += t4;
        }
      }
    }

    fittedPatches.push(fittedText);
  }

  return {
    formattedDiffPrompt: fittedPatches.join('\n\n'),
    usedTokens,
    fileCount: files.length,
  };
}
