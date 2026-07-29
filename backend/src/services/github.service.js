import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import path from 'path';
import config from '../config/env.js';
import prisma from '../config/db.js';

async function resolveInstallationId(installationId) {
  if (installationId && Number(installationId)) {
    return Number(installationId);
  }
  try {
    const inst = await prisma.installation.findFirst();
    if (inst && inst.githubInstallationId) {
      console.log(`ℹ️ [GitHub Auth Helper] Resolved Installation ID from DB: ${inst.githubInstallationId}`);
      return inst.githubInstallationId;
    }
  } catch (err) {}
  return null;
}

function getOctokit(installationId) {
  let privateKey = '';
  const keyPath = path.resolve(process.cwd(), config.github.privateKeyPath);
  if (fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, 'utf8');
  } else {
    console.warn(`⚠️ [GitHub Auth Warning] Private key file not found at ${keyPath}`);
  }

  const numericAppId = Number(config.github.appId);
  const numericInstallationId = Number(installationId);

  if (privateKey && numericAppId && numericInstallationId) {
    console.log(`🔐 [GitHub Auth] Authenticating as GitHub App (AppId: ${numericAppId}, InstallationId: ${numericInstallationId})`);
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: numericAppId,
        privateKey,
        installationId: numericInstallationId,
      },
    });
  }

  if (process.env.GITHUB_TOKEN) {
    console.log(`🔐 [GitHub Auth] Authenticating via GITHUB_TOKEN fallback`);
    return new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });
  }

  console.warn(`⚠️ [GitHub Auth Warning] Unauthenticated Octokit client (missing privateKey or installationId: ${installationId})`);
  return new Octokit();
}

async function fetchPrDiff(owner, repo, prNumber, installationId) {
  const resolvedId = await resolveInstallationId(installationId);
  console.log(`🔍 [GitHub API] Fetching PR diff files for ${owner}/${repo}#${prNumber}...`);
  const octokit = getOctokit(resolvedId);
  try {
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: Number(prNumber),
    });
    console.log(`✅ [GitHub API] Successfully fetched ${files.length} changed files for ${owner}/${repo}#${prNumber}`);
    return files;
  } catch (error) {
    console.error(`❌ [GitHub API Error] Failed to fetch PR diff files for ${owner}/${repo}#${prNumber}:`, error.message);
    return [];
  }
}

async function postPrComment(owner, repo, prNumber, installationId, markdownComment) {
  const resolvedId = await resolveInstallationId(installationId);
  console.log(`💬 [GitHub API] Posting markdown review comment on ${owner}/${repo}#${prNumber}...`);
  const octokit = getOctokit(resolvedId);
  try {
    const { data: comment } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: Number(prNumber),
      body: markdownComment,
    });
    console.log(`✅ [GitHub API] Successfully posted comment on ${owner}/${repo}#${prNumber}! Comment ID: ${comment.id}`);
    return comment;
  } catch (error) {
    console.error(`❌ [GitHub API Error] Failed to post comment on ${owner}/${repo}#${prNumber}:`, error.message);
    return null;
  }
}

async function createCheckRun(owner, repo, headSha, installationId) {
  const resolvedId = await resolveInstallationId(installationId);
  console.log(`✔️ [GitHub Checks] Creating Check Run on ${owner}/${repo}@${headSha ? headSha.substring(0, 7) : 'head'}...`);
  const octokit = getOctokit(resolvedId);
  try {
    const { data: checkRun } = await octokit.checks.create({
      owner,
      repo,
      name: 'AutoReview Code Review',
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      output: {
        title: 'AutoReview Processing',
        summary: 'Supervisor node and AI agents (Style & Security) are auditing diff hunks...',
      },
    });
    console.log(`✅ [GitHub Checks] Created Check Run ID: ${checkRun.id}`);
    return checkRun;
  } catch (error) {
    console.error(`❌ [GitHub Checks Error] Failed to create Check Run:`, error.message);
    return null;
  }
}

async function updateCheckRun(owner, repo, checkRunId, installationId, severityScore, markdownComment) {
  if (!checkRunId) return null;
  const resolvedId = await resolveInstallationId(installationId);
  console.log(`✔️ [GitHub Checks] Updating Check Run ID ${checkRunId}...`);
  const octokit = getOctokit(resolvedId);
  try {
    const conclusion = severityScore > 6 ? 'action_required' : 'success';
    const { data: checkRun } = await octokit.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: 'completed',
      completed_at: new Date().toISOString(),
      conclusion,
      output: {
        title: `AutoReview Summary (Severity: ${severityScore}/10)`,
        summary: markdownComment,
      },
    });
    console.log(`✅ [GitHub Checks] Successfully updated Check Run ID ${checkRun.id} (Conclusion: ${conclusion})`);
    return checkRun;
  } catch (error) {
    console.error(`❌ [GitHub Checks Error] Failed to update Check Run ID ${checkRunId}:`, error.message);
    return null;
  }
}

export {
  getOctokit,
  fetchPrDiff,
  postPrComment,
  createCheckRun,
  updateCheckRun,
};

