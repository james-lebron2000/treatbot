const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken } = require('../middleware/auth');
const trialCache = require('../services/trialCache');
const { HttpError } = require('../utils/httpError');

const router = express.Router();

function normalizeText(value) {
  return String(value || '').trim();
}

router.get('/cache', authenticateToken, asyncHandler(async (req, res) => {
  const metadata = trialCache.getCacheMetadata();
  const trials = await trialCache.loadNormalizedTrials();
  res.success({
    ...metadata,
    counts: {
      total: trials.length,
      recruiting: trials.filter((t) => t.status === 'recruiting').length,
      active: trials.filter((t) => t.status === 'active').length,
      completed: trials.filter((t) => t.status === 'completed').length,
      suspended: trials.filter((t) => t.status === 'suspended').length
    }
  });
}));

router.post('/refresh', authenticateToken, asyncHandler(async (_req, res) => {
  if (String(process.env.ALLOW_TRIAL_REFRESH || '').toLowerCase() !== 'true') {
    throw new HttpError(403, 'Trial refresh endpoint disabled');
  }

  await trialCache.refreshTrials();
  const metadata = trialCache.getCacheMetadata();
  const trials = await trialCache.loadNormalizedTrials();
  res.success({
    ...metadata,
    refreshedAt: new Date().toISOString(),
    total: trials.length
  }, { message: 'Trials refreshed' });
}));

router.get('/locations', authenticateToken, asyncHandler(async (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
  const trials = await trialCache.loadNormalizedTrials();
  const scoped = includeInactive
    ? trials
    : trials.filter((trial) => trial.status !== 'completed' && trial.status !== 'suspended');

  const provinces = new Map();
  const cities = new Map();

  scoped.forEach((trial) => {
    const provinceList = Array.isArray(trial.provinces) ? trial.provinces : (trial.province ? [trial.province] : []);
    const cityList = Array.isArray(trial.cities) ? trial.cities : (trial.city ? [trial.city] : []);

    provinceList.map(normalizeText).filter(Boolean).forEach((province) => {
      provinces.set(province, (provinces.get(province) || 0) + 1);
    });

    cityList.map(normalizeText).filter(Boolean).forEach((city) => {
      cities.set(city, (cities.get(city) || 0) + 1);
    });
  });

  const toSorted = (map) => Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  res.success({
    totals: {
      trials: scoped.length,
      provinces: provinces.size,
      cities: cities.size
    },
    provinces: toSorted(provinces).slice(0, 200),
    cities: toSorted(cities).slice(0, 200)
  });
}));

module.exports = router;
