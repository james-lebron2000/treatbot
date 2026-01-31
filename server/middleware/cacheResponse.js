const cacheService = require('../services/cache');

function cacheResponse({ ttl = Number(process.env.API_CACHE_TTL || 300), keyResolver, shouldCache } = {}) {
  return async function cacheMiddleware(req, res, next) {
    if (!keyResolver) return next();

    let cacheKey;
    try {
      cacheKey = await keyResolver(req);
    } catch (err) {
      return next(err);
    }

    if (!cacheKey) {
      return next();
    }

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.success(cached.data, cached.meta || {});
      }
    } catch (err) {
      // Ignore cache errors and continue
    }

    const originalSuccess = res.success.bind(res);

    res.success = async (data, { message = 'OK', status = 200, ...restMeta } = {}) => {
      if (!shouldCache || shouldCache(req, data, { message, status, ...restMeta })) {
        try {
          await cacheService.set(cacheKey, { data, meta: { message, status, ...restMeta } }, ttl);
        } catch (err) {
          // Ignore cache set errors
        }
      }
      return originalSuccess(data, { message, status, ...restMeta });
    };

    return next();
  };
}

module.exports = cacheResponse;
