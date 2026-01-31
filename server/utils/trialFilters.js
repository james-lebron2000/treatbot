function normalizePlace(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function splitPlaces(value) {
  if (!value) return [];
  return String(value)
    .split(/[,，、;；/\\|]+/)
    .map((part) => normalizePlace(part))
    .filter(Boolean);
}

function normalizePlaceList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => normalizePlace(v))
    .filter(Boolean);
}

function matchPlace(trial, candidates) {
  if (!candidates.length) return true;
  const provinceParts = [
    ...splitPlaces(trial?.province),
    ...(Array.isArray(trial?.provinces) ? trial.provinces.flatMap(splitPlaces) : [])
  ];
  const cityParts = [
    ...splitPlaces(trial?.city),
    ...(Array.isArray(trial?.cities) ? trial.cities.flatMap(splitPlaces) : [])
  ];
  const location = normalizePlace(trial?.location);
  const locationParts = splitPlaces(trial?.location);
  return candidates.some((needle) => {
    if (!needle) return false;
    if (provinceParts.includes(needle) || cityParts.includes(needle) || locationParts.includes(needle)) {
      return true;
    }
    return location.includes(needle);
  });
}

const { inferProvinceFromTrial, provinceToRegion, expandRegions } = require('./chinaGeo');

function filterTrialsByGeo(trials = [], geo = null) {
  if (!geo || typeof geo !== 'object') {
    return { trials, applied: false, reason: 'no-geo' };
  }

  const mode = String(geo.mode || 'national').trim().toLowerCase();
  if (mode === 'national') {
    return { trials, applied: false, reason: 'national' };
  }

  const provinces = normalizePlaceList(geo.provinces);
  const cities = normalizePlaceList(geo.cities);

  // Region-based fuzzy filtering (华东/华北/...)
  if (mode === 'region') {
    const regions = Array.isArray(geo.regions) ? geo.regions : (geo.region ? [geo.region] : []);
    const expanded = expandRegions(regions, geo.includeNeighbors === true);
    if (!expanded.length) return { trials, applied: false, reason: 'missing-regions' };

    const regionSet = new Set(expanded);
    const filtered = trials.filter((trial) => {
      const province = inferProvinceFromTrial(trial);
      const region = provinceToRegion(province);
      if (!region) return false; // unknown location -> exclude when region filter is active
      return regionSet.has(region);
    });

    return { trials: filtered, applied: filtered.length !== trials.length, reason: 'region' };
  }

  let filtered = trials;
  if (mode === 'province') {
    if (!provinces.length) return { trials, applied: false, reason: 'missing-provinces' };
    filtered = trials.filter((trial) => matchPlace(trial, provinces));
  } else if (mode === 'city') {
    if (!cities.length) return { trials, applied: false, reason: 'missing-cities' };
    filtered = trials.filter((trial) => matchPlace(trial, cities));
  } else {
    return { trials, applied: false, reason: 'unknown-mode' };
  }

  if (filtered.length === 0) {
    // Avoid empty candidate set; caller can decide whether to keep empty or fallback.
    return { trials: [], applied: true, reason: 'filtered-empty' };
  }

  return { trials: filtered, applied: filtered.length !== trials.length, reason: mode };
}

function filterTrialsByStatus(trials = [], statuses = null) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return { trials, applied: false };
  }
  const allowed = new Set(statuses.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  const filtered = trials.filter((trial) => allowed.has(String(trial?.status || '').toLowerCase()));
  return { trials: filtered, applied: filtered.length !== trials.length };
}

module.exports = {
  filterTrialsByGeo,
  filterTrialsByStatus
};
