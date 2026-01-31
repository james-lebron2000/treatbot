const { normaliseRecordForMatching } = require('./patientDataNormalizer');
const { deriveDiseaseSignals } = require('./trialPrefilter');

const SCORE_WEIGHTS = {
  disease: 40,
  stage: 15,
  mutation: 15,
  age: 10,
  gender: 5,
  ecog: 10,
  therapyLines: 5
};

const STAGE_REGEX = /stage\s*(0|i{1,3}v?|[0-4])(\w)?/i;
const ECOG_REGEX = /ecog[^0-9]*(\d)(?:\s*[-~至到–]|\s*(?:≤|<=|>=|≥|>|<)\s*)(\d)?/i;
const ECOG_EXCLUSION_REGEX = /ecog[^0-9]*(\d)(?:\s*[-~至到–]|\s*(?:≤|<=|>=|≥|>|<)\s*)(\d)?/i;
const THERAPY_LINE_LE_REGEX = /(?:≤|不超过|最多|no\s+more\s+than|<=)\s*(\d)\s*(?:线|lines?)/i;
const THERAPY_LINE_GE_REGEX = /(?:≥|至少|不低于|no\s+less\s+than|>=)\s*(\d)\s*(?:线|lines?)/i;

function resolveNormalizedRecord(recordLike) {
  if (!recordLike) return null;
  if (recordLike.canonical) {
    return recordLike;
  }
  if (recordLike.__normalizedForMatching) {
    return recordLike.__normalizedForMatching;
  }
  if (recordLike.structuredData || recordLike.clinicalArchive || recordLike.llmIntegrationData) {
    return normaliseRecordForMatching(recordLike);
  }
  if (recordLike.legacy && recordLike.__canonical) {
    return { legacy: recordLike.legacy, canonical: recordLike.__canonical, warnings: [], source: recordLike.source || 'legacy' };
  }
  if (typeof recordLike === 'object') {
    return normaliseRecordForMatching({ structuredData: recordLike.structuredData || recordLike });
  }
  return null;
}

function normalizeGene(gene) {
  if (!gene) return '';
  return String(gene).trim().toUpperCase();
}

function extractPatientFeatures(canonical = {}) {
  const biomarkers = canonical.biomarkers || {};
  const geneSet = new Set();
  Object.keys(biomarkers).forEach((gene) => {
    const normalized = normalizeGene(gene);
    if (normalized) geneSet.add(normalized);
    const value = biomarkers[gene];
    if (value) {
      String(value)
        .split(/[\s,;\/|]+/)
        .map((item) => normalizeGene(item))
        .filter(Boolean)
        .forEach((mutation) => geneSet.add(mutation));
    }
  });

  return {
    age: canonical.demographics?.age ?? null,
    gender: canonical.demographics?.gender || null,
    stage: canonical.diagnosis?.stage ? String(canonical.diagnosis.stage).trim().toUpperCase() : '',
    stageTokens: canonical.diagnosis?.stage ? String(canonical.diagnosis.stage).toUpperCase().split(/[\s-/]+/) : [],
    diagnoses: Array.isArray(canonical.diagnosis?.allDiagnoses) ? canonical.diagnosis.allDiagnoses : [],
    primaryDiagnosis: canonical.diagnosis?.primary || '',
    biomarkers,
    mutationSet: geneSet,
    previousLines: canonical.treatments?.previousLines ?? null,
    ecog: canonical.performance?.ecog ?? null,
    labs: canonical.labs || {}
  };
}

function buildTrialText(trial = {}) {
  const parts = [];
  if (trial.condition) parts.push(trial.condition);
  if (Array.isArray(trial.diseaseTags)) parts.push(trial.diseaseTags.join(' '));
  if (trial.diseaseTags && typeof trial.diseaseTags === 'string') parts.push(trial.diseaseTags);
  if (trial.title) parts.push(trial.title);
  if (Array.isArray(trial.inclusionCriteria)) parts.push(trial.inclusionCriteria.join(' '));
  if (Array.isArray(trial.exclusionCriteria)) parts.push(trial.exclusionCriteria.join(' '));
  const structuredEligibility = trial.structuredEligibility || {};
  if (Array.isArray(structuredEligibility.inclusion)) {
    parts.push(structuredEligibility.inclusion.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
  }
  if (Array.isArray(structuredEligibility.exclusion)) {
    parts.push(structuredEligibility.exclusion.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function containsAny(text, matchers = []) {
  if (!text) return false;
  return matchers.some((keyword) => keyword && text.includes(keyword));
}

function extractECOGLimits(trial = {}) {
  const inclusion = Array.isArray(trial.inclusionCriteria) ? trial.inclusionCriteria : [];
  const exclusion = Array.isArray(trial.exclusionCriteria) ? trial.exclusionCriteria : [];
  const structured = trial.structuredEligibility || {};
  const candidates = [];
  const collectFromText = (text) => {
    if (!text) return;
    const match = ECOG_REGEX.exec(text);
    if (match) {
      const first = Number(match[1]);
      const second = match[2] != null ? Number(match[2]) : first;
      candidates.push({ min: Math.min(first, second), max: Math.max(first, second) });
    }
  };
  [...inclusion, ...exclusion].forEach((text) => collectFromText(text));
  (structured.inclusion || []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.intent === 'performance_status') {
      const numeric = entry.numeric || {};
      candidates.push({
        min: numeric.min != null ? Number(numeric.min) : 0,
        max: numeric.max != null ? Number(numeric.max) : Number(numeric.value ?? 5)
      });
      return;
    }
    if (entry.text) collectFromText(entry.text);
  });
  if (!candidates.length) return null;
  return candidates.reduce((acc, cur) => ({
    min: cur.min != null ? (acc.min != null ? Math.max(acc.min, cur.min) : cur.min) : acc.min,
    max: cur.max != null ? (acc.max != null ? Math.min(acc.max, cur.max) : cur.max) : acc.max
  }), { min: 0, max: 5 });
}

function extractTherapyLineLimits(trial = {}) {
  const inclusion = Array.isArray(trial.inclusionCriteria) ? trial.inclusionCriteria : [];
  const exclusion = Array.isArray(trial.exclusionCriteria) ? trial.exclusionCriteria : [];
  const structured = trial.structuredEligibility || {};
  const limits = { min: null, max: null };
  const parseLine = (text) => {
    if (!text) return;
    const maxMatch = THERAPY_LINE_LE_REGEX.exec(text);
    if (maxMatch) {
      const value = Number(maxMatch[1]);
      limits.max = limits.max == null ? value : Math.min(limits.max, value);
    }
    const minMatch = THERAPY_LINE_GE_REGEX.exec(text);
    if (minMatch) {
      const value = Number(minMatch[1]);
      limits.min = limits.min == null ? value : Math.max(limits.min, value);
    }
  };
  [...inclusion, ...exclusion].forEach(parseLine);
  (structured.inclusion || []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.intent === 'line_of_therapy') {
      const numeric = entry.numeric || {};
      if (numeric.max != null) limits.max = limits.max == null ? Number(numeric.max) : Math.min(limits.max, Number(numeric.max));
      if (numeric.min != null) limits.min = limits.min == null ? Number(numeric.min) : Math.max(limits.min, Number(numeric.min));
    }
    if (entry.text) parseLine(entry.text);
  });
  return limits;
}

function buildInclusionCheck(criterion, value, result) {
  return {
    criterion,
    patient_value: value,
    result
  };
}

function buildStageRegex(stageTokens = []) {
  if (!stageTokens.length) return null;
  const normalized = stageTokens
    .map((token) => String(token).toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);
  if (!normalized.length) return null;
  const pattern = normalized
    .map((token) => token.replace(/([A-Z])/g, '$1').replace(/IV/g, '(IV|4)').replace(/III/g, '(III|3)').replace(/II/g, '(II|2)').replace(/I/g, '(I|1)'))
    .join('|');
  if (!pattern) return null;
  return new RegExp(pattern, 'i');
}

function computeClassicMatches(trials, recordLike, options = {}) {
  if (!Array.isArray(trials) || trials.length === 0) {
    return [];
  }

  const normalizedRecord = resolveNormalizedRecord(recordLike);
  if (!normalizedRecord?.canonical) {
    return [];
  }

  const canonical = normalizedRecord.canonical;
  const patient = extractPatientFeatures(canonical);
  const diseaseSignals = options.diseaseSignals || deriveDiseaseSignals(canonical);
  const diseaseMatchers = diseaseSignals?.matchers || [];
  const trialResults = [];
  const stageRegex = buildStageRegex([patient.stage, ...(patient.stageTokens || [])]);

  const lowerDiagnoses = [patient.primaryDiagnosis, ...patient.diagnoses]
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean);

  trials.forEach((trial) => {
    const inclusionChecks = [];
    const exclusionChecks = [];
    const matchingFactors = [];
    const matchingBarriers = [];
    let score = 0;
    let hardExclusion = false;

    const trialText = buildTrialText(trial);

    if (diseaseMatchers.length) {
      const matchedKeyword = diseaseMatchers.find((keyword) => trialText.includes(keyword));
      if (matchedKeyword) {
        score += SCORE_WEIGHTS.disease;
        matchingFactors.push(`疾病标签匹配: ${matchedKeyword}`);
        inclusionChecks.push(buildInclusionCheck('疾病匹配', matchedKeyword, '满足'));
      } else if (containsAny(trialText, lowerDiagnoses)) {
        score += SCORE_WEIGHTS.disease * 0.7;
        matchingFactors.push('疾病匹配（模糊）');
        inclusionChecks.push(buildInclusionCheck('疾病匹配', '模糊匹配', '不确定'));
      } else {
        exclusionChecks.push(buildInclusionCheck('疾病匹配', '未匹配到相关关键词', '不确定'));
      }
    }

    if (Number.isFinite(patient.age)) {
      if (trial.ageRange) {
        const min = trial.ageRange.min != null ? Number(trial.ageRange.min) : null;
        const max = trial.ageRange.max != null ? Number(trial.ageRange.max) : null;
        if ((min != null && patient.age < min) || (max != null && patient.age > max)) {
          exclusionChecks.push(buildInclusionCheck('年龄范围', `${min ?? '-'}-${max ?? '-'}`, '不满足'));
          matchingBarriers.push({ issue: `年龄需 ${min ?? '-'}-${max ?? '-'} 岁`, severity: 'High' });
          hardExclusion = true;
        } else {
          score += SCORE_WEIGHTS.age;
          matchingFactors.push('年龄范围匹配');
          inclusionChecks.push(buildInclusionCheck('年龄范围', `${patient.age} 岁`, '满足'));
        }
      } else {
        inclusionChecks.push(buildInclusionCheck('年龄范围', '试验未限定', '不确定'));
      }
    } else {
      inclusionChecks.push(buildInclusionCheck('年龄范围', '患者年龄缺失', '不确定'));
    }

    if (patient.gender && trial.gender && trial.gender !== 'both') {
      if (trial.gender === patient.gender) {
        score += SCORE_WEIGHTS.gender;
        matchingFactors.push('性别匹配');
        inclusionChecks.push(buildInclusionCheck('性别要求', patient.gender, '满足'));
      } else {
        exclusionChecks.push(buildInclusionCheck('性别要求', trial.gender, '不满足'));
        matchingBarriers.push({ issue: `仅限${trial.gender === 'male' ? '男性' : '女性'}`, severity: 'High' });
        hardExclusion = true;
      }
    }

    if (patient.mutationSet.size && Array.isArray(trial.targetMutations) && trial.targetMutations.length) {
      const intersection = trial.targetMutations
        .map((mutation) => normalizeGene(mutation))
        .filter((mutation) => mutation && patient.mutationSet.has(mutation));
      if (intersection.length) {
        score += SCORE_WEIGHTS.mutation;
        matchingFactors.push(`基因突变匹配: ${intersection.join(', ')}`);
        inclusionChecks.push(buildInclusionCheck('基因突变', intersection.join(', '), '满足'));
      } else {
        exclusionChecks.push(buildInclusionCheck('基因突变', '患者突变不在试验列表', '不确定'));
      }
    }

    if (patient.stage && stageRegex) {
      if (stageRegex.test(trialText)) {
        score += SCORE_WEIGHTS.stage;
        matchingFactors.push(`分期匹配: ${patient.stage}`);
        inclusionChecks.push(buildInclusionCheck('疾病分期', patient.stage, '满足'));
      } else {
        exclusionChecks.push(buildInclusionCheck('疾病分期', patient.stage, '不确定'));
      }
    }

    if (Number.isFinite(patient.ecog)) {
      const ecogRange = extractECOGLimits(trial);
      if (ecogRange) {
        const min = ecogRange.min ?? 0;
        const max = ecogRange.max ?? 5;
        if (patient.ecog >= min && patient.ecog <= max) {
          score += SCORE_WEIGHTS.ecog;
          matchingFactors.push(`ECOG 匹配 (允许 ${min}-${max})`);
          inclusionChecks.push(buildInclusionCheck('ECOG 评分', String(patient.ecog), '满足'));
        } else {
          exclusionChecks.push(buildInclusionCheck('ECOG 评分', `要求 ${min}-${max}`, '不满足'));
          matchingBarriers.push({ issue: `ECOG 需 ${min}-${max}`, severity: 'High' });
          hardExclusion = true;
        }
      } else {
        inclusionChecks.push(buildInclusionCheck('ECOG 评分', '试验未限制', '不确定'));
      }
    }

    if (Number.isFinite(patient.previousLines)) {
      const limits = extractTherapyLineLimits(trial);
      if (limits.max != null && patient.previousLines > limits.max) {
        exclusionChecks.push(buildInclusionCheck('既往治疗线数', `≤ ${limits.max} 线`, '不满足'));
        matchingBarriers.push({ issue: `需 ≤ ${limits.max} 线治疗`, severity: 'High' });
        hardExclusion = true;
      } else if (limits.min != null && patient.previousLines < limits.min) {
        exclusionChecks.push(buildInclusionCheck('既往治疗线数', `≥ ${limits.min} 线`, '不满足'));
        matchingBarriers.push({ issue: `需 ≥ ${limits.min} 线治疗`, severity: 'Medium' });
      } else if (limits.min != null || limits.max != null) {
        score += SCORE_WEIGHTS.therapyLines;
        matchingFactors.push('既往治疗线数匹配');
        inclusionChecks.push(buildInclusionCheck('既往治疗线数', `${patient.previousLines} 线`, '满足'));
      }
    }

    const inclusionMet = inclusionChecks.filter((check) => check.result === '满足').map((check) => check.criterion);
    const exclusionTriggered = exclusionChecks.filter((check) => check.result === '不满足' || check.result === '可能不满足').map((check) => check.criterion);
    const uncertain = inclusionChecks.filter((check) => check.result === '不确定').map((check) => check.criterion);

    let matchScore = Math.min(100, Math.max(0, Math.round(score)));
    if (hardExclusion) {
      matchScore = Math.min(matchScore, 25);
    }

    const detailedAnalysis = [];
    if (matchingFactors.length) {
      detailedAnalysis.push({ category: '匹配亮点', details: matchingFactors });
    }
    if (matchingBarriers.length) {
      detailedAnalysis.push({ category: '潜在阻断因素', details: matchingBarriers.map((barrier) => barrier.issue) });
    }

    const result = {
      trial,
      matchScore,
      matchingFactors,
      matchingBarriers,
      inclusionChecks,
      exclusionChecks,
      summary: {
        inclusion_met: inclusionMet,
        exclusion_triggered: exclusionTriggered,
        uncertain
      },
      detailedAnalysis,
      rankReason: matchingFactors.join('；') || undefined,
      hardExclusion
    };

    trialResults.push(result);
  });

  return trialResults
    .filter((item) => item.matchScore > 10 || !item.hardExclusion)
    .sort((a, b) => b.matchScore - a.matchScore)
    .map(({ hardExclusion, ...rest }) => rest);
}

module.exports = {
  computeClassicMatches
};
