import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import prisma from '../config/db.js';
import { authenticateUser, optionalAuthenticateUser } from '../middleware/auth.middleware.js';

const router = express.Router();

function generateTokens(user) {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, githubId: user.githubId, type: 'access' },
    config.jwtSecret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id, username: user.username, githubId: user.githubId, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}

// GET /api/auth/github/url - Get GitHub OAuth Authorize URL
router.get('/github/url', (req, res) => {
  const clientId = config.github.clientId;
  const redirectUri = `${config.frontendUrl}/auth/callback`;
  const appSlug = config.github.appName || 'codezyautoreview';

  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;

  if (!clientId) {
    return res.json({
      configured: false,
      installUrl,
      message: 'GITHUB_CLIENT_ID is not configured in backend .env. Demo authentication available.',
    });
  }

  const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email,read:user`;

  res.json({
    configured: true,
    url: oauthUrl,
    installUrl,
  });
});

// GET /api/auth/github/callback - Exchange OAuth code for Access Token & Profile
router.get('/github/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code is missing' });
  }

  try {
    // 1. Exchange code for access_token with GitHub
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error('❌ [OAuth Error]:', tokenData);
      return res.status(400).json({ error: tokenData.error_description || 'Failed to exchange GitHub OAuth code' });
    }

    const ghAccessToken = tokenData.access_token;

    // 2. Fetch User Profile from GitHub API
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${ghAccessToken}`,
        'User-Agent': 'Codezy-AutoReview-App',
      },
    });

    const ghUser = await userResponse.json();

    if (!ghUser || !ghUser.id) {
      return res.status(400).json({ error: 'Failed to fetch GitHub user profile' });
    }

    // 3. Upsert User in Prisma DB
    let user = await prisma.user.upsert({
      where: { githubId: ghUser.id },
      update: {
        username: ghUser.login,
        name: ghUser.name || ghUser.login,
        email: ghUser.email || null,
        avatarUrl: ghUser.avatar_url,
        accessToken: ghAccessToken,
      },
      create: {
        githubId: ghUser.id,
        username: ghUser.login,
        name: ghUser.name || ghUser.login,
        email: ghUser.email || null,
        avatarUrl: ghUser.avatar_url,
        accessToken: ghAccessToken,
      },
    });

    // 4. Auto-link any existing Installation matching this account username
    await prisma.installation.updateMany({
      where: {
        accountUsername: ghUser.login,
        userId: null,
      },
      data: {
        userId: user.id,
      },
    });

    // 5. Generate 15m Access Token & 7d Refresh Token
    const { accessToken, refreshToken } = generateTokens(user);

    // Update refreshToken in DB
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Redirect back to frontend callback handler with both tokens
    res.redirect(`${config.frontendUrl}/auth/callback?token=${accessToken}&refreshToken=${refreshToken}`);
  } catch (error) {
    console.error('❌ [OAuth Callback Error]:', error);
    res.status(500).json({ error: 'Authentication failed due to server error' });
  }
});

// POST /api/auth/demo-login - Quick Dev/Demo Login
router.post('/demo-login', async (req, res) => {
  const { username = 'yashtech00', githubId = 12345678 } = req.body;

  try {
    let user = await prisma.user.upsert({
      where: { githubId: Number(githubId) },
      update: {
        username,
        name: username,
        avatarUrl: `https://github.com/${username}.png`,
      },
      create: {
        githubId: Number(githubId),
        username,
        name: username,
        avatarUrl: `https://github.com/${username}.png`,
      },
    });

    // Link any installation matching account username
    await prisma.installation.updateMany({
      where: {
        accountUsername: username,
        userId: null,
      },
      data: {
        userId: user.id,
      },
    });

    const { accessToken, refreshToken } = generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({ token: accessToken, refreshToken, user });
  } catch (error) {
    console.error('❌ [Demo Login Error]:', error.message);
    res.status(500).json({ error: 'Demo login failed' });
  }
});

// POST /api/auth/refresh - Refresh Access Token (15m) using Refresh Token (7d)
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, config.jwtSecret);
    if (decoded.type && decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found or session expired' });
    }

    if (user.refreshToken && user.refreshToken !== refreshToken) {
      return res.status(401).json({ error: 'Refresh token mismatch or revoked' });
    }

    const tokens = generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (error) {
    console.error('❌ [Token Refresh Error]:', error.message);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// GET /api/auth/me - Get current logged-in user profile & installations
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const installations = await prisma.installation.findMany({
      where: {
        OR: [
          { userId: req.user.id },
          { accountUsername: req.user.username },
        ],
        status: { not: 'DELETED' },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activeInstallations = installations.filter(i => i.status === 'ACTIVE');
    const hasInstallation = activeInstallations.length > 0;
    const activeInstallation = activeInstallations[0] || null;

    const appSlug = config.github.appName || 'codezyautoreview';


    res.json({
      user: req.user,
      installations,
      hasInstallation,
      activeInstallation,
      appInstallUrl: `https://github.com/apps/${appSlug}/installations/new`,
    });
  } catch (error) {
    console.error('❌ [/api/auth/me Error]:', error.message);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});


// GET /api/installations - List active installations
router.get('/installations', optionalAuthenticateUser, async (req, res) => {
  try {
    let whereClause = { status: { not: 'DELETED' } };
    if (req.user) {
      whereClause.OR = [
        { userId: req.user.id },
        { accountUsername: req.user.username },
      ];
    }

    const installations = await prisma.installation.findMany({
      where: whereClause,
      include: {
        user: {
          select: { username: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const appSlug = config.github.appName || 'codezyautoreview';


    res.json({
      installations,
      appInstallUrl: `https://github.com/apps/${appSlug}/installations/new`,
    });
  } catch (error) {
    console.error('❌ [/api/installations Error]:', error.message);
    res.status(500).json({ error: 'Failed to fetch installations' });
  }
});

// POST /api/installations/link - Link installation to logged in user
router.post('/installations/link', authenticateUser, async (req, res) => {
  const { githubInstallationId } = req.body;

  if (!githubInstallationId) {
    return res.status(400).json({ error: 'githubInstallationId is required' });
  }

  try {
    const installation = await prisma.installation.upsert({
      where: { githubInstallationId: Number(githubInstallationId) },
      update: {
        userId: req.user.id,
        accountUsername: req.user.username,
        status: 'ACTIVE',
      },
      create: {
        githubInstallationId: Number(githubInstallationId),
        accountUsername: req.user.username,
        userId: req.user.id,
        status: 'ACTIVE',
      },
    });

    res.json({ message: 'Installation linked successfully', installation });
  } catch (error) {
    console.error('❌ [/api/installations/link Error]:', error.message);
    res.status(500).json({ error: 'Failed to link installation' });
  }
});

// DELETE /api/installations/:id - Remove or disconnect GitHub App installation from platform
router.delete('/installations/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const installation = await prisma.installation.findUnique({
      where: { id },
    });

    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Verify ownership
    if (installation.userId && installation.userId !== req.user.id && installation.accountUsername !== req.user.username) {
      return res.status(403).json({ error: 'Unauthorized to delete this installation' });
    }

    // Mark as DELETED in DB
    await prisma.installation.update({
      where: { id },
      data: {
        status: 'DELETED',
        userId: null,
      },
    });

    res.json({ message: 'Installation unlinked/removed successfully', id });
  } catch (error) {
    console.error('❌ [DELETE /api/installations/:id Error]:', error.message);
    res.status(500).json({ error: 'Failed to remove installation' });
  }
});

export default router;

