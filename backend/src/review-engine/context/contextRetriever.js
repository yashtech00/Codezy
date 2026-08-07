/**
 * AST & Code Intelligence Context Retriever
 * Resolves symbol dependencies, function signatures, imports, and surrounding scope for changed hunks.
 */

export const extractImports = (fileContent = '') => {
  const importRegex = /(?:import\s+(?:[\s\w{},*]+)\s+from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
  const imports = [];
  let match;

  while ((match = importRegex.exec(fileContent)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath && !importPath.startsWith('.')) continue; // ignore node_modules for local context
    if (importPath) imports.push(importPath);
  }

  return imports;
};

/**
 * Extracts top-level function signatures, class declarations, and export statements.
 */
export const extractSymbolSignatures = (fileContent = '') => {
  if (!fileContent) return [];
  const lines = fileContent.split('\n');
  const signatures = [];

  const signatureRegex = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z0-9_$]+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(signatureRegex);
    if (match) {
      signatures.push({
        line: i + 1,
        symbol: match[1],
        signature: line.substring(0, 100),
      });
    }
  }

  return signatures;
};

/**
 * Extracts surrounding function/scope context headers from patch diff hunks.
 */
export const extractHunkScopeHeaders = (patch = '') => {
  if (!patch) return [];
  const hunkHeaderRegex = /^@@\s+-\d+,\d+\s+\+(\d+),\d+\s+@@\s*(.*)$/gm;
  const scopes = [];
  let match;

  while ((match = hunkHeaderRegex.exec(patch)) !== null) {
    const startLine = parseInt(match[1], 10);
    const scopeHeader = match[2]?.trim() || '';
    scopes.push({ startLine, scopeHeader });
  }

  return scopes;
};

export const retrieveHunkContext = async ({ changedFiles = [], pillars = [] }) => {
  const contextMap = new Map();
  const formattedContextLines = [];

  for (const file of changedFiles) {
    const filename = file.filename;
    const content = file.content || '';
    const patch = file.patch || '';

    const imports = extractImports(content);
    const signatures = extractSymbolSignatures(content);
    const hunkScopes = extractHunkScopeHeaders(patch);

    const fileContext = {
      filename,
      imports,
      signatures: signatures.slice(0, 10),
      hunkScopes,
      symbolContext: `Imports: ${imports.join(', ') || 'none'} | Scope Headers: ${hunkScopes.map(h => h.scopeHeader).filter(Boolean).join('; ') || 'none'}`,
    };

    contextMap.set(filename, fileContext);

    if (imports.length > 0 || hunkScopes.length > 0) {
      formattedContextLines.push(`File: ${filename}\n- ${fileContext.symbolContext}`);
    }
  }

  return {
    getContextForFile: (filePath) => contextMap.get(filePath) || null,
    allContext: Array.from(contextMap.values()),
    formattedContextPrompt: formattedContextLines.join('\n\n'),
  };
};
