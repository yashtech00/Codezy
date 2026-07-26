const { ChatOpenAI } = require('@langchain/openai');
const config = require('../config/env');

function getModel() {
  if (config.openai.apiKey) {
    return new ChatOpenAI({
      openAIApiKey: config.openai.apiKey,
      modelName: 'gpt-4o-mini',
      temperature: 0.2,
    });
  }
  return null;
}

async function runSupervisorNode(stats, files) {
  const onlyDocs = files.every(f => f.filename.endsWith('.md') || f.filename.endsWith('.txt'));
  if (onlyDocs || files.length === 0) {
    return { route: 'SKIP', reason: 'No code changes detected in PR diff.' };
  }

  if (stats.totalLinesChanged < 50) {
    return { route: 'STYLE_ONLY' };
  }

  return { route: 'STYLE_AND_SECURITY' };
}

async function runStyleAgent(files) {
  const model = getModel();

  if (!model) {
    // Mock intelligent findings when OpenAI key isn't provided
    return [
      {
        file: files[0]?.filename || 'src/index.js',
        line: 12,
        issue: 'Consider using camelCase for variable naming consistency.',
        severity: 'LOW',
      },
    ];
  }

  const prompt = `You are a Senior Code Style & Quality Reviewer.
Analyze the following pull request diff and identify naming, formatting, code-smell, and architectural best-practice violations.

PR Diff:
${JSON.stringify(files, null, 2)}

Return a strict JSON array of objects with the schema:
[
  {
    "file": "path/to/file",
    "line": 10,
    "issue": "Description of style issue",
    "severity": "LOW" | "MEDIUM" | "HIGH"
  }
]`;

  try {
    const response = await model.invoke(prompt);
    const text = response.content.trim();
    const jsonMatch = text.match(/\[.*\]/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (error) {
    console.error('[StyleAgent] Error:', error.message);
    return [];
  }
}

async function runSecurityAgent(files) {
  const model = getModel();

  if (!model) {
    // Mock intelligent security findings when OpenAI key isn't provided
    return [
      {
        file: files[0]?.filename || 'src/config.js',
        line: 45,
        issue: 'Potential hardcoded token or secret key detected.',
        severity: 'HIGH',
      },
    ];
  }

  const prompt = `You are a Senior Security Audit Specialist.
Analyze the following pull request diff specifically for critical security vulnerabilities: hardcoded secrets/API keys, SQL injection risks, unsafe eval calls, missing input validation, or improper authentication/authorization controls.

PR Diff:
${JSON.stringify(files, null, 2)}

Return a strict JSON array of objects with the schema:
[
  {
    "file": "path/to/file",
    "line": 25,
    "issue": "Description of security risk",
    "severity": "HIGH" | "CRITICAL"
  }
]`;

  try {
    const response = await model.invoke(prompt);
    const text = response.content.trim();
    const jsonMatch = text.match(/\[.*\]/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (error) {
    console.error('[SecurityAgent] Error:', error.message);
    return [];
  }
}

function calculateSeverityScore(styleFindings, securityFindings) {
  let score = 0;

  styleFindings.forEach(f => {
    if (f.severity === 'HIGH') score += 2;
    else score += 1;
  });

  securityFindings.forEach(f => {
    if (f.severity === 'CRITICAL') score += 5;
    else if (f.severity === 'HIGH') score += 3;
    else score += 2;
  });

  return Math.min(10, score);
}

function formatMarkdownComment(severityScore, styleFindings, securityFindings) {
  let markdown = `## 🤖 AutoReview Summary\n\n`;
  markdown += `**Severity Score**: \`${severityScore}/10\`\n\n`;

  if (securityFindings.length === 0 && styleFindings.length === 0) {
    markdown += `✅ **No critical security or style issues found! Great work.**\n`;
    return markdown;
  }

  if (securityFindings.length > 0) {
    markdown += `### 🔒 Security (${securityFindings.length} issue${securityFindings.length > 1 ? 's' : ''})\n`;
    securityFindings.forEach(f => {
      markdown += `- **\`${f.file}:${f.line}\`** [${f.severity}]: ${f.issue}\n`;
    });
    markdown += `\n`;
  }

  if (styleFindings.length > 0) {
    markdown += `### 🎨 Style & Quality (${styleFindings.length} issue${styleFindings.length > 1 ? 's' : ''})\n`;
    styleFindings.forEach(f => {
      markdown += `- **\`${f.file}:${f.line}\`** [${f.severity}]: ${f.issue}\n`;
    });
    markdown += `\n`;
  }

  markdown += `---\n*Automated review by AutoReview Multi-Agent Engine.*`;
  return markdown;
}

module.exports = {
  runSupervisorNode,
  runStyleAgent,
  runSecurityAgent,
  calculateSeverityScore,
  formatMarkdownComment,
};
