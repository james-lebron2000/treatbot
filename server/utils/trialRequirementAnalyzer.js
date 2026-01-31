function collectStructuredEligibility(trial) {
  const structured = trial?.structuredEligibility || {};
  const inclusion = Array.isArray(structured.inclusion) ? structured.inclusion : [];
  const exclusion = Array.isArray(structured.exclusion) ? structured.exclusion : [];
  return { inclusion, exclusion };
}

function normalizeIntent(intent) {
  if (!intent) return null;
  const value = String(intent).trim().toLowerCase();
  return value || null;
}

function summarizeTrialRequirements(trials = []) {
  const counts = new Map();
  const tags = new Map();

  trials.forEach((trial) => {
    const { inclusion, exclusion } = collectStructuredEligibility(trial);
    [...inclusion, ...exclusion].forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const intent = normalizeIntent(entry.intent);
      if (intent && intent !== 'general') {
        counts.set(intent, (counts.get(intent) || 0) + 1);
      }
      const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
      entryTags.forEach((tag) => {
        const normalizedTag = normalizeIntent(tag);
        if (!normalizedTag || normalizedTag === 'general') return;
        tags.set(normalizedTag, (tags.get(normalizedTag) || 0) + 1);
      });
    });
  });

  const topIntents = Array.from(counts.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  const topTags = Array.from(tags.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalTrials: Array.isArray(trials) ? trials.length : 0,
    intents: Object.fromEntries(counts.entries()),
    tags: Object.fromEntries(tags.entries()),
    topIntents: topIntents.slice(0, 25),
    topTags: topTags.slice(0, 25)
  };
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function computePatientRequirementCoverage(normalizedRecord, intents = []) {
  const canonical = normalizedRecord?.canonical || {};
  const coverage = {};

  const get = (path) => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), canonical);

  const checkers = {
    age: () => hasValue(get('demographics.age')),
    gender: () => hasValue(get('demographics.gender')),
    ecog: () => hasValue(get('performance.ecog')),
    survival: () => hasValue(get('performance.survivalMonths')),
    measurable: () => hasValue(get('status.measurableLesions')),
    pregnancy: () => hasValue(get('status.pregnancyStatus')),
    hbv: () => hasValue(get('infections.hbv')),
    hcv: () => hasValue(get('infections.hcv')),
    hiv: () => hasValue(get('infections.hiv')),
    platelet: () => hasValue(get('labs.blood.platelets')),
    wbc: () => hasValue(get('labs.blood.wbc')),
    neutrophil: () => hasValue(get('labs.blood.anc')),
    hemoglobin: () => hasValue(get('labs.blood.hemoglobin')),
    alt: () => hasValue(get('labs.liver.alt')),
    ast: () => hasValue(get('labs.liver.ast')),
    bilirubin: () => hasValue(get('labs.liver.bilirubin')),
    creatinine: () => hasValue(get('labs.renal.creatinine')),
    urea: () => hasValue(get('labs.renal.urea')),
    cns: () => hasValue(get('status.metastasisSites')) // heuristic
  };

  intents.forEach((intent) => {
    const key = normalizeIntent(intent);
    if (!key) return;
    const checker = checkers[key];
    coverage[key] = checker ? Boolean(checker()) : null;
  });

  const missing = Object.entries(coverage)
    .filter(([, ok]) => ok === false)
    .map(([key]) => key);

  return {
    coverage,
    missingIntents: missing,
    unknownIntents: Object.entries(coverage).filter(([, ok]) => ok === null).map(([key]) => key)
  };
}

module.exports = {
  summarizeTrialRequirements,
  computePatientRequirementCoverage
};
