require('dotenv').config();

const required = [
  'DATABASE_URL',
  'GITHUB_WEBHOOK_SECRET',
];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[WARNING] Missing env var: ${key}. Make sure it is set in .env`);
  }
}

module.exports = {
  port: process.env.PORT || 3000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  databaseUrl: process.env.DATABASE_URL,
  github: {
    appId: process.env.GITHUB_APP_ID || '123456',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || 'development_webhook_secret',
    privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || './keys/github-app-private-key.pem',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  },
};
