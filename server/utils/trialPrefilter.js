const logger = require('./logger');
const { filterTrialsByGeo } = require('./trialFilters');

const DISEASE_RULES = [
  {
    slug: 'colorectal',
    tumorType: 'solid',
    tags: ['实体瘤', '结直肠癌'],
    keywords: ['结直肠', '结肠', '直肠', 'colorectal', 'colon', 'rectal', 'crc']
  },
  {
    slug: 'lung',
    tumorType: 'solid',
    tags: ['实体瘤', '肺癌'],
    keywords: ['肺癌', '非小细胞', '小细胞', 'nsclc', 'sclc', 'lung']
  },
  {
    slug: 'breast',
    tumorType: 'solid',
    tags: ['实体瘤', '乳腺癌'],
    keywords: ['乳腺癌', '乳癌', 'breast']
  },
  {
    slug: 'liver',
    tumorType: 'solid',
    tags: ['实体瘤', '肝癌'],
    keywords: ['肝癌', '肝细胞癌', 'hcc', 'hepatocellular', 'liver']
  },
  {
    slug: 'gastric',
    tumorType: 'solid',
    tags: ['实体瘤', '胃癌'],
    keywords: ['胃癌', '胃肠', '胃', 'gastric', 'stomach']
  },
  {
    slug: 'pancreatic',
    tumorType: 'solid',
    tags: ['实体瘤', '胰腺癌'],
    keywords: ['胰腺癌', '胰腺', 'pancreatic']
  },
  {
    slug: 'ovarian',
    tumorType: 'solid',
    tags: ['实体瘤', '卵巢癌'],
    keywords: ['卵巢', 'ovarian']
  },
  {
    slug: 'prostate',
    tumorType: 'solid',
    tags: ['实体瘤', '前列腺癌'],
    keywords: ['前列腺', 'prostate']
  },
  {
    slug: 'glioma',
    tumorType: 'solid',
    tags: ['实体瘤', '胶质瘤'],
    keywords: ['胶质瘤', 'glioma', '脑胶质瘤', '脑瘤']
  },
  {
    slug: 'leukemia',
    tumorType: 'hematologic',
    tags: ['血液肿瘤', '白血病'],
    keywords: ['白血病', 'leukemia', 'aml', 'all']
  },
  {
    slug: 'lymphoma',
    tumorType: 'hematologic',
    tags: ['血液肿瘤', '淋巴瘤'],
    keywords: ['淋巴瘤', 'lymphoma', 'hodgkin', 'non-hodgkin']
  },
  {
    slug: 'myeloma',
    tumorType: 'hematologic',
    tags: ['血液肿瘤', '骨髓瘤'],
    keywords: ['骨髓瘤', 'myeloma', 'mm', '多发性骨髓瘤']
  }
];

const HEMATOLOGY_POSITIVE = [
  /leukemia/i,
  /lymphoma/i,
  /myeloma/i,
  /血液肿瘤/,
  /白血病/,
  /淋巴瘤/,
  /骨髓瘤/
];

const HEMATOLOGY_NEGATIVE = [
  /leukemia/i,
  /lymphoma/i,
  /myeloma/i,
  /白血病/,
  /淋巴瘤/,
  /骨髓瘤/
];

function normalizeTerm(term) {
  if (!term) return '';
  return String(term).trim().toLowerCase();
}

function collectDiagnosisTerms(canonical = {}) {
  const terms = [];
  if (canonical.diagnosis) {
    if (canonical.diagnosis.primary) terms.push(canonical.diagnosis.primary);
    if (Array.isArray(canonical.diagnosis.allDiagnoses)) {
      terms.push(...canonical.diagnosis.allDiagnoses);
    }
    if (Array.isArray(canonical.diagnosis.diseaseLabels)) {
      terms.push(...canonical.diagnosis.diseaseLabels);
    }
    if (canonical.diagnosis.histology) terms.push(canonical.diagnosis.histology);
  }
  return terms.filter(Boolean);
}

function matchDiseaseRule(lowerText) {
  for (const rule of DISEASE_RULES) {
    if (rule.keywords.some((keyword) => lowerText.includes(keyword))) {
      return rule;
    }
  }
  return null;
}

function deriveDiseaseSignals(canonical = {}) {
  const rawTerms = collectDiagnosisTerms(canonical);
  const loweredCombined = normalizeTerm(rawTerms.join(' '));
  const matchedRule = loweredCombined ? matchDiseaseRule(loweredCombined) : null;

  let tumorType = matchedRule?.tumorType || null;
  if (!tumorType) {
    const isHematologic = HEMATOLOGY_POSITIVE.some((regex) => regex.test(loweredCombined));
    tumorType = isHematologic ? 'hematologic' : 'solid';
  }

  const matchers = new Set();
  rawTerms.forEach((term) => {
    const normalized = normalizeTerm(term);
    if (normalized) {
      matchers.add(normalized);
      normalized.split(/[\s、，,\/]+/).forEach((part) => {
        if (part) matchers.add(part);
      });
    }
  });
  if (matchedRule?.keywords) {
    matchedRule.keywords.forEach((keyword) => matchers.add(keyword));
  }

  return {
    tumorType,
    slug: matchedRule?.slug || (tumorType === 'hematologic' ? 'hematologic-malignancy' : 'solid-tumor'),
    diseaseTags: matchedRule?.tags || [],
    rawTerms,
    matchers: Array.from(matchers).filter(Boolean)
  };
}

function buildTrialText(trial = {}) {
  const parts = [
    trial.condition,
    trial.diseaseTags,
    trial.title,
    Array.isArray(trial.inclusionCriteria) ? trial.inclusionCriteria.join(' ') : '',
    Array.isArray(trial.exclusionCriteria) ? trial.exclusionCriteria.join(' ') : ''
  ];
  return normalizeTerm(parts.filter(Boolean).join(' '));
}

function filterByDisease(trials = [], diseaseSignals = null) {
  if (!diseaseSignals) {
    return { filtered: trials, applied: false, reason: 'no-signals' };
  }
  const keywords = diseaseSignals.matchers || [];
  const tumorType = diseaseSignals.tumorType;

  const filtered = trials.filter((trial) => {
    const haystack = buildTrialText(trial);
    if (!haystack) {
      return true;
    }

    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return true;
    }

    if (tumorType === 'hematologic') {
      return HEMATOLOGY_POSITIVE.some((regex) => regex.test(haystack));
    }

    if (tumorType === 'solid') {
      if (HEMATOLOGY_NEGATIVE.some((regex) => regex.test(haystack))) {
        return false;
      }
      return true;
    }

    return true;
  });

  if (filtered.length === 0) {
    return { filtered: trials, applied: false, reason: 'fallback' };
  }

  return { filtered, applied: filtered.length !== trials.length, reason: 'disease' };
}

function filterByDemographics(trials = [], canonical = {}) {
  let filtered = trials;
  let applied = false;

  const age = canonical?.demographics?.age;
  if (Number.isFinite(age)) {
    const ageFiltered = filtered.filter((trial) => {
      if (!trial.ageRange) return true;
      const { min, max } = trial.ageRange;
      if (min != null && age < min) return false;
      if (max != null && age > max) return false;
      return true;
    });
    if (ageFiltered.length > 0) {
      filtered = ageFiltered;
      applied = applied || ageFiltered.length !== trials.length;
    }
  }

  const gender = canonical?.demographics?.gender;
  if (gender && filtered.length) {
    const genderFiltered = filtered.filter((trial) => !trial.gender || trial.gender === 'both' || trial.gender === gender);
    if (genderFiltered.length > 0) {
      filtered = genderFiltered;
      applied = true;
    }
  }

  return { filtered, applied };
}

function prefilterTrials(trials = [], normalizedRecord = null, options = {}) {
  const stats = {
    totalCandidates: trials.length,
    diseaseApplied: false,
    demographicsApplied: false,
    locationApplied: false,
    afterDisease: trials.length,
    afterDemographics: trials.length,
    afterLocation: trials.length,
    geoReason: null
  };

  if (!trials.length) {
    return { trials, stats, diseaseSignals: null, normalizedRecord };
  }

  const canonical = normalizedRecord?.canonical || null;
  let diseaseSignals = null;
  let filtered = trials;

  if (canonical) {
    diseaseSignals = deriveDiseaseSignals(canonical);
    const diseaseResult = filterByDisease(filtered, diseaseSignals);
    filtered = diseaseResult.filtered;
    stats.diseaseApplied = diseaseResult.applied;
    stats.afterDisease = filtered.length;
    stats.diseaseFallback = diseaseResult.reason === 'fallback';

    const demographicsResult = filterByDemographics(filtered, canonical);
    filtered = demographicsResult.filtered;
    stats.demographicsApplied = demographicsResult.applied;
    stats.afterDemographics = filtered.length;

    const geoResult = filterTrialsByGeo(filtered, options?.geo || null);
    filtered = geoResult.trials;
    stats.locationApplied = Boolean(geoResult.applied);
    stats.geoReason = geoResult.reason || null;
    stats.afterLocation = filtered.length;
  }

  if (!filtered.length) {
    const geoMode = String(options?.geo?.mode || 'national').trim().toLowerCase();
    const hasStrictGeo = geoMode && geoMode !== 'national';
    if (hasStrictGeo) {
      logger.info({ step: 'prefilter', reason: 'empty-after-geo', geoMode }, 'No trials match geo filter');
      stats.evaluatedTrials = 0;
      return { trials: [], stats, diseaseSignals };
    }

    logger.warn({ step: 'prefilter', reason: 'empty-after-filters' }, 'Trials filtered out completely, reverting to full list');
    filtered = trials;
    stats.afterDisease = trials.length;
    stats.afterDemographics = trials.length;
    stats.afterLocation = trials.length;
    stats.diseaseApplied = false;
    stats.demographicsApplied = false;
    stats.diseaseFallback = true;
    stats.locationApplied = false;
    stats.geoReason = 'fallback';
  }

  stats.evaluatedTrials = filtered.length;

  return { trials: filtered, stats, diseaseSignals };
}

module.exports = {
  prefilterTrials,
  deriveDiseaseSignals
};
