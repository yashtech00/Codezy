/**
 * Repository Context Retriever for Codezy Level 2
 * Resolves symbol dependencies, imports, and related context files for changed code.
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

export const retrieveHunkContext = async ({ changedFiles = [], maxDepth = 2 }) => {
  const contextMap = new Map();

  for (const file of changedFiles) {
    if (!file.content) continue;

    const imports = extractImports(file.content);
    contextMap.set(file.filename, {
      filename: file.filename,
      imports,
      symbolContext: `Extracted imports: ${imports.join(', ') || 'none'}`,
    });
  }

  return {
    getContextForFile: (filePath) => contextMap.get(filePath) || null,
    allContext: Array.from(contextMap.values()),
  };
};
