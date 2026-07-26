const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');

function getOctokit(installationId) {
  // Check if private key file exists
  let privateKey = '';
  const keyPath = path.resolve(process.cwd(), config.github.privateKeyPath);
  if (fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, 'utf8');
  }

  if (privateKey && config.github.appId && installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.github.appId,
        privateKey,
        installationId,
      },
    });
  }

  // Return unauthenticated or token-authenticated Octokit for testing fallback
  return new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
  });
}

async function fetchPrDiff(owner, repo, prNumber, installationId) {
  const octokit = getOctokit(installationId);
  try {
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: Number(prNumber),
    });
    return files;
  } catch (error) {
    console.error(`[GitHubService] Failed to fetch PR diff files for ${owner}/${repo}#${prNumber}:`, error.message);
    // Return empty array fallback if GitHub API call fails in dev/test
    return [];
  }
}

async function postPrComment(owner, repo, prNumber, installationId, markdownComment) {
  const octokit = getOctokit(installationId);
  try {
    const { data: comment } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: Number(prNumber),
      body: markdownComment,
    });
    return comment;
  } catch (error) {
    console.error(`[GitHubService] Failed to post comment on ${owner}/${repo}#${prNumber}:`, error.message);
    return null;
  }
}

module.exports = {
  getOctokit,
  fetchPrDiff,
  postPrComment,
};
