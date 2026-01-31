function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function getPath(obj, path) {
  if (!obj) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function anyPathHasValue(obj, paths) {
  return paths.some((path) => hasValue(getPath(obj, path)));
}

function computeStructuredDataQuality(structuredData) {
  const required = [
    { key: 'primary_diagnosis', paths: ['primary_diagnosis', 'diagnosis'] },
    { key: 'staging_value', paths: ['staging_value', 'stage'] },
    { key: 'age', paths: ['age'] },
    { key: 'gender', paths: ['gender'] },
    { key: 'ecog_score', paths: ['ecog_score', 'performanceStatus'] },
    { key: 'metastasis_sites', paths: ['metastasis_sites', 'metastasis'] },
    { key: 'measurable_lesions', paths: ['measurable_lesions', 'measurableLesions'] },
    { key: 'hbv_status', paths: ['viral_hepatitis.hbv_status', 'viralHepatitis.hbv_status'] },
    { key: 'treatments', paths: ['systemic_treatments', 'previousTreatments'] }
  ];

  const present = required.filter((entry) => anyPathHasValue(structuredData, entry.paths));
  const missing = required.filter((entry) => !anyPathHasValue(structuredData, entry.paths));

  const completionRate = required.length > 0
    ? String(Math.round((present.length / required.length) * 100))
    : '100';

  return {
    missingFields: missing.map((entry) => entry.key),
    presentFields: present.map((entry) => entry.key),
    isComplete: missing.length === 0,
    completionRate
  };
}

module.exports = {
  computeStructuredDataQuality
};

