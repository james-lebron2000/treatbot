const { RateLimiterMemory, RateLimiterRedis } = require('rate-limiter-flexible');
const logger = require('../utils/logger');
const { getRedisClient, isRedisEnabled } = require('../config/redis');

const defaultOptions = {
  points: Number(process.env.RATE_LIMIT_POINTS) || 120,
  duration: Number(process.env.RATE_LIMIT_DURATION) || 60,
  blockDuration: Number(process.env.RATE_LIMIT_BLOCK_DURATION) || 0
};

const limiterCache = new Map();

function getLimiter(namespace, options) {
  if (!limiterCache.has(namespace)) {
    let limiter;
    if (isRedisEnabled()) {
      limiter = new RateLimiterRedis({
        storeClient: getRedisClient(),
        keyPrefix: namespace,
        points: options.points,
        duration: options.duration,
        blockDuration: options.blockDuration
      });
      logger.info({ namespace }, 'Rate limiter initialised (redis)');
    } else {
      limiter = new RateLimiterMemory({
        keyPrefix: namespace,
        points: options.points,
        duration: options.duration,
        blockDuration: options.blockDuration
      });
      logger.info({ namespace }, 'Rate limiter initialised (memory)');
    }
    limiterCache.set(namespace, limiter);
  }
  return limiterCache.get(namespace);
}

function rateLimit(namespace, overrides = {}) {
  const limiterOptions = {
    ...defaultOptions,
    ...overrides
  };
  const limiter = getLimiter(namespace, limiterOptions);

  return async (req, res, next) => {
    try {
      await limiter.consume(req.ip);
      return next();
    } catch (rejRes) {
      const retryAfter = Math.max(1, Math.ceil(rejRes.msBeforeNext / 1000));
      res.set('Retry-After', String(retryAfter));
      logger.warn({ namespace, ip: req.ip, retryAfter }, 'Rate limit exceeded');
      return res.fail('Too many requests, please try again later.', {
        status: 429,
        code: 'rate_limited',
        meta: {
          namespace,
          retryAfter,
          points: limiterOptions.points,
          duration: limiterOptions.duration
        }
      });
    }
  };
}

module.exports = { rateLimit };
