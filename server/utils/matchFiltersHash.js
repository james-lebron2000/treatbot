const crypto = require('crypto');

function normalizeStatuses(statuses) {
  if (!Array.isArray(statuses)) return null;
  const normalized = statuses
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return null;
  return Array.from(new Set(normalized)).sort();
}

function normalizeGeo(geo) {
  if (!geo || typeof geo !== 'object') return null;
  const mode = geo.mode ? String(geo.mode).trim().toLowerCase() : 'national';
  const normalizeList = (arr) => Array.isArray(arr)
    ? Array.from(new Set(arr.map((x) => String(x).trim()).filter(Boolean))).sort()
    : null;

  return {
    mode,
    provinces: normalizeList(geo.provinces),
    cities: normalizeList(geo.cities),
    regions: normalizeList(geo.regions),
    includeNeighbors: geo.includeNeighbors === true
  };
}

function normalizeMatchFilters(filters) {
  if (!filters || typeof filters !== 'object') return null;
  const statuses = normalizeStatuses(filters.statuses);
  const geo = normalizeGeo(filters.geo);
  return {
    statuses,
    geo
  };
}

function computeMatchFiltersHash(filters) {
  const normalized = normalizeMatchFilters(filters);
  const payload = normalized ? JSON.stringify(normalized) : 'null';
  return crypto.createHash('sha1').update(payload).digest('hex');
}

module.exports = {
  normalizeMatchFilters,
  computeMatchFiltersHash
};

