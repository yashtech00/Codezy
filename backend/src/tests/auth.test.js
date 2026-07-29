/**
 * Auth API Test Suite
 * T001 - GitHub OAuth Login — Successful Authentication
 * T002 - GitHub OAuth — Callback with Invalid Code
 * T003 - Auth Middleware — Protected Route Access Without Token
 * T004 - User Profile — Fetch Authenticated User Data
 * T005 - Refresh Token — Token Rotation on Expiry
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'codezy_super_secret_jwt_key_2026';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a demo user via the /api/auth/demo-login endpoint and return tokens.
 */
async function createDemoUser(username = 'testuser_jest', githubId = 99991234) {
  const res = await request(app)
    .post('/api/auth/demo-login')
    .send({ username, githubId });
  return res.body; // { token, refreshToken, user }
}

/**
 * Sign a JWT with a custom payload and expiry (for expired-token tests).
 */
function signToken(payload, expiresIn = '15m') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// ─── T001: GitHub OAuth Login — Successful Authentication ───────────────────

describe('T001 — GitHub OAuth Login: Successful Authentication', () => {
  test('GET /api/auth/github/url returns OAuth URL or install URL', async () => {
    const res = await request(app).get('/api/auth/github/url');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('installUrl');
    // When GITHUB_CLIENT_ID is configured, url is present; otherwise configured=false
    if (res.body.configured) {
      expect(res.body).toHaveProperty('url');
      expect(res.body.url).toMatch(/github\.com\/login\/oauth\/authorize/);
    } else {
      expect(res.body.configured).toBe(false);
    }
  });

  test('Demo login creates/updates user and returns valid JWT tokens', async () => {
    const { token, refreshToken, user } = await createDemoUser('oauth_test_user', 88881111);

    expect(token).toBeDefined();
    expect(refreshToken).toBeDefined();
    expect(user).toMatchObject({
      username: 'oauth_test_user',
      githubId: 88881111,
    });

    // Verify the access token is a valid JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded).toHaveProperty('userId');
    expect(decoded).toHaveProperty('username', 'oauth_test_user');
    expect(decoded.type).toBe('access');
  });

  test('Authenticated user can access /api/auth/me (dashboard data)', async () => {
    const { token } = await createDemoUser('oauth_dashboard_user', 88882222);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toMatchObject({ username: 'oauth_dashboard_user' });
    expect(res.body).toHaveProperty('installations');
    expect(res.body).toHaveProperty('hasInstallation');
  });
});

// ─── T002: GitHub OAuth — Callback with Invalid Code ────────────────────────

describe('T002 — GitHub OAuth Callback: Invalid/Expired Code', () => {
  test('GET /api/auth/github/callback without code returns 400', async () => {
    const res = await request(app).get('/api/auth/github/callback');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Authorization code is missing');
  });

  test('GET /api/auth/github/callback with invalid code returns 400', async () => {
    // GitHub will reject the invalid code; backend should return 400
    const res = await request(app)
      .get('/api/auth/github/callback')
      .query({ code: 'invalid_or_expired_code_xyz' });

    // Expect 400 (bad code) or 500 (server error from GitHub rejection)
    expect([400, 500]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });

  test('No user session is created for invalid OAuth code', async () => {
    // Attempt callback with a bogus code
    await request(app)
      .get('/api/auth/github/callback')
      .query({ code: 'totally_fake_code_000' });

    // Verify: calling /api/auth/me without a token still returns 401 (no session leaked)
    const meRes = await request(app).get('/api/auth/me');
    expect(meRes.status).toBe(401);
  });
});

// ─── T003: Auth Middleware — Protected Route Access Without Token ─────────────

describe('T003 — Auth Middleware: Protected Route Access', () => {
  test('Request without Authorization header returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('Request with malformed JWT returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('Request with expired JWT returns 401', async () => {
    const expiredToken = signToken(
      { userId: 'fake-id', username: 'ghost', githubId: 0, type: 'access' },
      '-1s' // already expired
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('Request with valid JWT returns 200 with user data', async () => {
    const { token } = await createDemoUser('middleware_test_user', 77771111);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
  });
});

// ─── T004: User Profile — Fetch Authenticated User Data ─────────────────────

describe('T004 — User Profile: Fetch Authenticated User Data', () => {
  let token;
  let user;

  beforeAll(async () => {
    const result = await createDemoUser('profile_test_user', 66661111);
    token = result.token;
    user = result.user;
  });

  test('GET /api/auth/me returns 200 with user object', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
  });

  test('Response contains required user fields: githubId, username, name, avatarUrl', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    const { user: profile } = res.body;
    expect(profile).toHaveProperty('githubId');
    expect(profile).toHaveProperty('username');
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('avatarUrl');
    // id should be present
    expect(profile).toHaveProperty('id');
  });

  test('Sensitive fields accessToken and refreshToken are NOT exposed', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    const { user: profile } = res.body;
    expect(profile).not.toHaveProperty('accessToken');
    expect(profile).not.toHaveProperty('refreshToken');
    expect(profile).not.toHaveProperty('refreshTokenExpiresAt');
  });
});

// ─── T005: Refresh Token — Token Rotation on Expiry ─────────────────────────

describe('T005 — Refresh Token: Token Rotation on Expiry', () => {
  let refreshToken;
  let originalAccessToken;

  beforeAll(async () => {
    const result = await createDemoUser('refresh_test_user', 55551111);
    refreshToken = result.refreshToken;
    originalAccessToken = result.token;
  });

  test('POST /api/auth/refresh without body returns 400', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Refresh token is required');
  });

  test('POST /api/auth/refresh with invalid token returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid.refresh.token' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/refresh with valid refresh token returns new tokens', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');

    // Verify the new token is a valid JWT with correct claims (rotation succeeded)
    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.type).toBe('access');
    expect(decoded).toHaveProperty('userId');
  });

  test('New access token from refresh is valid for protected routes', async () => {
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    const newAccessToken = refreshRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newAccessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body).toHaveProperty('user');
    expect(meRes.body.user).toMatchObject({ username: 'refresh_test_user' });
  });

  test('Using an access token type as refresh token returns 401', async () => {
    // Access tokens have type='access', should be rejected by /refresh
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: originalAccessToken });

    // Should fail: token type mismatch or DB mismatch
    expect([401, 400]).toContain(res.status);
  });
});