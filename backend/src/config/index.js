'use strict';
require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 4000,

  db: {
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'procura',
    user: process.env.DB_USER || 'procura_user',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'af-south-1',
    bucket: process.env.S3_BUCKET || 'procura-deliveries',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },

  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiBase: 'https://graph.facebook.com/v19.0',
  },

  escalation: {
    defaultSlaHours: parseInt(process.env.DEFAULT_SLA_HOURS, 10) || 72,
    autoEscalateHours: parseInt(process.env.ESCALATION_AUTO_ESCALATE_HOURS, 10) || 2,
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
};

// Fail fast on missing critical secrets in production
if (config.env === 'production') {
  const required = ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL', 'ENCRYPTION_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

module.exports = config;
