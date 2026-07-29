import 'dotenv/config';

const required = [
  'DATABASE_URL',
  'GITHUB_WEBHOOK_SECRET',
];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[WARNING] Missing env var: ${key}. Make sure it is set in .env`);
  }
}

export const port = process.env.PORT || 3000;
export const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
export const databaseUrl = process.env.DATABASE_URL;
export const jwtSecret = process.env.JWT_SECRET || 'codezy_super_secret_jwt_key_2026';
export const github = {
  appId: process.env.GITHUB_APP_ID || '123456',
  appName: process.env.GITHUB_APP_NAME || 'codezyautoreview',

  clientId: process.env.GITHUB_CLIENT_ID || '',
  clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || 'development_webhook_secret',
  privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || './keys/github-app-private-key.pem',
};
export const redis = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
};
export const openai = {
  apiKey: process.env.OPENAI_API_KEY || '',
};
export const gemini = {
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
};

const config = {
  port,
  frontendUrl,
  databaseUrl,
  jwtSecret,
  github,
  redis,
  openai,
  gemini,
};

export default config;
