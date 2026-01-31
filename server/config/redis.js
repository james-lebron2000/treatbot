const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient;
let redisEnabled;

function resolveConfig() {
  const mode = (process.env.APP_MODE || process.env.NODE_ENV || 'mock').toLowerCase();
  if (mode === 'mock') {
    return { enabled: false, reason: 'APP_MODE=mock' };
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return { enabled: true, options: redisUrl };
  }

  const host = process.env.REDIS_HOST;
  if (!host) {
    return { enabled: false, reason: 'No REDIS_URL or REDIS_HOST provided' };
  }

  return {
    enabled: true,
    options: {
      host,
      port: Number(process.env.REDIS_PORT || 6379),
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined
    }
  };
}

function initialiseClient() {
  if (redisClient !== undefined) {
    return redisClient;
  }

  const config = resolveConfig();
  redisEnabled = config.enabled;
  if (!config.enabled) {
    logger.warn({ reason: config.reason }, 'Redis disabled – using in-memory fallbacks');
    redisClient = null;
    return redisClient;
  }

  const instance = typeof config.options === 'string'
    ? new Redis(config.options, { maxRetriesPerRequest: null })
    : new Redis({ ...config.options, maxRetriesPerRequest: null });
  instance.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });
  instance.on('connect', () => {
    logger.info('Connected to Redis');
  });

  redisClient = instance;
  return redisClient;
}

function getRedisClient() {
  return initialiseClient();
}

function isRedisEnabled() {
  if (redisEnabled === undefined) {
    initialiseClient();
  }
  return Boolean(redisEnabled);
}

async function pingRedis() {
  const client = getRedisClient();
  if (!client) {
    return { ok: false, message: 'Redis disabled' };
  }
  try {
    const result = await client.ping();
    return { ok: result === 'PONG', message: result };
  } catch (err) {
    logger.error({ err }, 'Redis ping failed');
    return { ok: false, message: err.message };
  }
}

module.exports = {
  getRedisClient,
  isRedisEnabled,
  pingRedis
};
