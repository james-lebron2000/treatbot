const logger = require('../utils/logger');
const { normalizePatientArchive, toNumber } = require('../utils/patientProfileAdapter');
const { validateMatchResults } = require('../utils/matchResultValidator');
const { recordEligibilitySource } = require('../monitoring/metrics');

function deriveLabel(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '未命名条目';
  const labelMatch = trimmed.match(/^([^：:\(（]{1,16})[：:\(（]?/);
  if (labelMatch && labelMatch[1]) {
    return labelMatch[1].trim();
  }
  return trimmed.slice(0, 16);
}

function parseRange(text) {
  if (!text) return {};
  const normalized = text.replace(/，/g, ',').replace(/；/g, ';');
  const rangeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至|到|～)\s*(\d+(?:\.\d+)?)/);
  const minMatch = normalized.match(/(≥|>=|不少于|不小于|至少|大于等于)\s*(\d+(?:\.\d+)?(?:\s*[×x]\s*10\^?\d+)?)/);
  const maxMatch = normalized.match(/(≤|<=|不大于|至多|最多|小于等于)\s*(\d+(?:\.\d+)?(?:\s*[×x]\s*10\^?\d+)?)/);
  const gtMatch = normalized.match(/(>|大于)\s*(\d+(?:\.\d+)?)/);
  const ltMatch = normalized.match(/(<|小于)\s*(\d+(?:\.\d+)?)/);

  const result = {};
  if (rangeMatch) {
    result.min = toNumber(rangeMatch[1]);
    result.max = toNumber(rangeMatch[2]);
  }
  if (minMatch) {
    result.min = toNumber(minMatch[2]);
  } else if (gtMatch) {
    const value = toNumber(gtMatch[2]);
    result.min = Number.isFinite(value) ? value + 1e-6 : value;
  }
  if (maxMatch) {
    result.max = toNumber(maxMatch[2]);
  } else if (ltMatch) {
    const value = toNumber(ltMatch[2]);
    result.max = Number.isFinite(value) ? value - 1e-6 : value;
  }
  return result;
}

function compareNumeric(patientValue, requirement) {
  if (patientValue === null || patientValue === undefined) return '不确定';
  const { min, max } = requirement;
  if (min !== undefined && min !== null && patientValue < min) {
    return '不满足';
  }
  if (max !== undefined && max !== null && patientValue > max) {
    return '不满足';
  }
  return '满足';
}

function evaluateAge(trial, criterion, patient) {
  if (!criterion || !/(年龄|age)/i.test(criterion)) return null;
  const requirement = parseRange(criterion);
  if ((!requirement.min && !requirement.max) && trial.ageRange) {
    requirement.min = trial.ageRange.min;
    requirement.max = trial.ageRange.max;
  }
  const patientValue = patient.demographics.age.value;
  const patientRaw = patient.demographics.age.raw;
  const result = compareNumeric(patientValue, requirement);
  const constraint = [];
  if (requirement.min !== undefined && requirement.min !== null) constraint.push(`≥ ${requirement.min}`);
  if (requirement.max !== undefined && requirement.max !== null) constraint.push(`≤ ${requirement.max}`);
  return {
    criterion: constraint.length ? `年龄 ${constraint.join(' 且 ')}` : criterion,
    patient_value: patientRaw || (patientValue !== null ? `${patientValue}岁` : ''),
    result
  };
}

function evaluateECOG(criterion, patient) {
  if (!criterion || !/ECOG/i.test(criterion)) return null;
  const requirement = parseRange(criterion);
  if (!requirement.max) {
    const maxMatch = criterion.match(/ECOG\s*(?:PS)?\s*(\d)/i);
    if (maxMatch) {
      requirement.max = Number(maxMatch[1]);
    }
  }
  const patientValue = patient.ecog.value;
  const patientRaw = patient.ecog.raw;
  const result = compareNumeric(patientValue, { min: requirement.min, max: requirement.max });
  return {
    criterion: requirement.max !== undefined ? `ECOG ≤ ${requirement.max}` : criterion,
    patient_value: patientRaw || (patientValue !== null ? `ECOG=${patientValue}` : ''),
    result
  };
}

function evaluateSurvival(criterion, patient) {
  if (!criterion || !/(生存期|survival)/i.test(criterion)) return null;
  const requirement = parseRange(criterion);
  if (!requirement.min) {
    const match = criterion.match(/(≥|不少于|至少)\s*(\d+)/);
    if (match) requirement.min = Number(match[2]);
  }
  const patientValue = patient.status.estimatedSurvival.value;
  const patientRaw = patient.status.estimatedSurvival.raw;
  const result = compareNumeric(patientValue, requirement);
  return {
    criterion: requirement.min ? `预计生存期 ≥ ${requirement.min}个月` : criterion,
    patient_value: patientRaw || '',
    result
  };
}

function evaluatePlatelets(criterion, patient) {
  if (!criterion || !/(血小板|platelet)/i.test(criterion)) return null;
  const requirement = parseRange(criterion);
  if (!requirement.min && /≥|不少于|至少/.test(criterion)) {
    const threshold = criterion.match(/(≥|不少于|至少)\s*([^\s]+)/);
    if (threshold) {
      requirement.min = toNumber(threshold[2]);
    }
  }
  const patientValue = patient.labs.platelets.value;
  const patientRaw = patient.labs.platelets.raw;
  const result = compareNumeric(patientValue, requirement);
  return {
    criterion: requirement.min ? `血小板 ≥ ${thresholdDisplay(requirement.min)}` : criterion,
    patient_value: patientRaw,
    result
  };
}

function thresholdDisplay(value) {
  if (value === null || value === undefined) return '';
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(0)}×10^9/L`;
  }
  return `${value}`;
}

function evaluateHBV(criterion, patient, type) {
  if (!criterion || !/(HBV|乙型?肝炎|乙肝)/i.test(criterion)) return null;
  const hbvInfo = patient.infection.hbv;
  if (!hbvInfo) {
    return {
      criterion,
      patient_value: '',
      result: '不确定'
    };
  }
  const lower = hbvInfo.toLowerCase();
  if (/(阴性|negative|未感染|未见)/.test(lower)) {
    return {
      criterion,
      patient_value: hbvInfo,
      result: type === 'exclusion' ? '满足' : '满足'
    };
  }
  if (/(dna|阳性|positive|抗病毒)/.test(lower)) {
    return {
      criterion,
      patient_value: hbvInfo,
      result: type === 'exclusion' ? '可能不满足' : '可能不满足'
    };
  }
  return {
    criterion,
    patient_value: hbvInfo,
    result: '不确定'
  };
}

function evaluateGender(trial, criterion, patient) {
  const genderRequirement = (trial.gender || '').toLowerCase();
  if (!genderRequirement || genderRequirement === 'both') return null;
  const patientGender = (patient.demographics.gender || '').toLowerCase();
  if (!patientGender) {
    return {
      criterion: '性别要求',
      patient_value: '',
      result: '不确定'
    };
  }
  const matches = (genderRequirement === patientGender) ||
    (genderRequirement === 'male' && /男/.test(patientGender)) ||
    (genderRequirement === 'female' && /女/.test(patientGender));
  return {
    criterion: `性别 = ${genderRequirement}`,
    patient_value: patient.demographics.gender,
    result: matches ? '满足' : '不满足'
  };
}

function evaluateMeasurable(criterion, patient) {
  if (!criterion || !/(可测量|measurable)/i.test(criterion)) return null;
  const status = patient.status.measurableLesions;
  return {
    criterion,
    patient_value: status === null ? '' : (status ? '存在可测量病灶' : '未见可测量病灶'),
    result: status === null ? '不确定' : (status ? '满足' : '不满足')
  };
}

function evaluateOrganFunction(criterion, patient) {
  if (!criterion || !/(器官功能|肝功能|肾功能|organ function)/i.test(criterion)) return null;
  const status = patient.status.organFunctionOk;
  return {
    criterion,
    patient_value: status === null ? '' : (status ? '器官功能良好' : '器官功能不全'),
    result: status === null ? '不确定' : (status ? '满足' : '不满足')
  };
}

function evaluateDiagnosis(trial, patient) {
  if (!trial.condition) return null;
  const diagnosis = patient.diagnosis.primary;
  if (!diagnosis) {
    return {
      criterion: `疾病适应症: ${trial.condition}`,
      patient_value: '',
      result: '不确定'
    };
  }
  const matches = diagnosis.includes(trial.condition) || trial.condition.includes(diagnosis);
  return {
    criterion: `疾病适应症: ${trial.condition}`,
    patient_value: diagnosis,
    result: matches ? '满足' : '可能不满足'
  };
}

function evaluateCriterionList(criteria = [], patient, trial, type) {
  const checks = [];
  criteria.forEach((text) => {
    const entry =
      evaluateAge(trial, text, patient)
      || evaluateECOG(text, patient)
      || evaluateSurvival(text, patient)
      || evaluatePlatelets(text, patient)
      || evaluateMeasurable(text, patient)
      || evaluateOrganFunction(text, patient)
      || evaluateHBV(text, patient, type);

    if (entry) {
      checks.push({ ...entry, source: text });
    } else {
      checks.push({
        criterion: text,
        patient_value: '',
        result: '不确定'
      });
    }
  });
  return checks;
}

function getEligibilityCriteria(trial, type) {
  const structured = trial?.structuredEligibility?.[type];
  if (Array.isArray(structured) && structured.length > 0) {
    recordEligibilitySource(type, 'structured');
    return structured
      .map((item) => item?.criterion || item?.label || item?.description || '')
      .filter((text) => typeof text === 'string' && text.trim().length > 0);
  }

  const legacy = type === 'inclusion' ? trial?.inclusionCriteria : trial?.exclusionCriteria;
  if (Array.isArray(legacy) && legacy.length > 0) {
    recordEligibilitySource(type, 'legacy');
    logger.debug({ trialId: trial.trialId, type }, 'Using legacy eligibility criteria');
    return legacy.filter((text) => typeof text === 'string' && text.trim().length > 0);
  }

  recordEligibilitySource(type, 'missing');
  logger.warn({ trialId: trial.trialId, type }, 'No eligibility criteria available');
  return [];
}

function summariseChecks(inclusionChecks, exclusionChecks) {
  const summary = {
    inclusion_met: [],
    exclusion_triggered: [],
    uncertain: []
  };

  inclusionChecks.forEach((check) => {
    const label = deriveLabel(check.criterion || check.source);
    if (check.result === '满足') {
      summary.inclusion_met.push(label);
    } else if (check.result === '不满足' || check.result === '可能不满足') {
      summary.exclusion_triggered.push(label);
    } else if (check.result === '不确定') {
      summary.uncertain.push(label);
    }
  });

  exclusionChecks.forEach((check) => {
    const label = deriveLabel(check.criterion || check.source);
    if (check.result === '满足') {
      // satisfied exclusion means not triggered
      return;
    }
    if (check.result === '不满足' || check.result === '可能不满足') {
      summary.exclusion_triggered.push(label);
    } else if (check.result === '不确定') {
      summary.uncertain.push(label);
    }
  });

  summary.inclusion_met = Array.from(new Set(summary.inclusion_met));
  summary.exclusion_triggered = Array.from(new Set(summary.exclusion_triggered));
  summary.uncertain = Array.from(new Set(summary.uncertain));
  return summary;
}

function computeMatchScore(inclusionChecks, exclusionChecks) {
  const inclusionTotal = inclusionChecks.length || 0;
  const inclusionMet = inclusionChecks.filter((c) => c.result === '满足').length;
  const inclusionFailed = inclusionChecks.filter((c) => c.result === '不满足').length;
  const uncertain = inclusionChecks.filter((c) => c.result === '不确定').length
    + exclusionChecks.filter((c) => c.result === '不确定').length;
  const exclusionTriggered = exclusionChecks.filter((c) => c.result === '不满足' || c.result === '可能不满足').length;

  const base = inclusionTotal ? (inclusionMet / inclusionTotal) * 60 : 40;
  const score = Math.round(Math.max(
    0,
    Math.min(100, base + 40 - (inclusionFailed * 15) - (exclusionTriggered * 25) - (uncertain * 8))
  ));
  return score;
}

function buildTrialMatch(trial, patient) {
  const inclusionSource = getEligibilityCriteria(trial, 'inclusion');
  const exclusionSource = getEligibilityCriteria(trial, 'exclusion');

  const inclusionChecks = evaluateCriterionList(inclusionSource, patient, trial, 'inclusion');
  const exclusionChecks = evaluateCriterionList(exclusionSource, patient, trial, 'exclusion');

  const diagnosisCheck = evaluateDiagnosis(trial, patient);
  if (diagnosisCheck) {
    inclusionChecks.unshift({ ...diagnosisCheck, source: diagnosisCheck.criterion });
  }

  const summary = summariseChecks(inclusionChecks, exclusionChecks);
  const matchScore = computeMatchScore(inclusionChecks, exclusionChecks);

  return {
    trial_id: trial.trialId,
    trial_title: trial.title,
    match_score: matchScore,
    inclusion_checks: inclusionChecks.map(({ source, ...rest }) => rest),
    exclusion_checks: exclusionChecks.map(({ source, ...rest }) => rest),
    summary,
    trial_metadata: {
      phase: trial.phase,
      location: trial.location,
      condition: trial.condition,
      targetMutations: trial.targetMutations,
      gender: trial.gender,
      ageRange: trial.ageRange,
      inclusionCriteria: trial.inclusionCriteria,
      exclusionCriteria: trial.exclusionCriteria,
      structuredEligibility: trial.structuredEligibility
    }
  };
}

function matchTrialsWithArchive(clinicalArchive, trials = []) {
  if (!clinicalArchive) return [];
  const patient = normalizePatientArchive(clinicalArchive);
  const results = trials.map((trial) => {
    try {
      return buildTrialMatch(trial, patient);
    } catch (error) {
      logger.warn({ err: error, trialId: trial.trialId }, 'Enhanced matcher failed for trial');
      return null;
    }
  }).filter(Boolean).sort((a, b) => b.match_score - a.match_score);

  try {
    return validateMatchResults(results, 'enhanced-rule');
  } catch (error) {
    logger.error({ err: error }, 'Enhanced matcher results failed validation');
    return [];
  }
}

module.exports = {
  matchTrialsWithArchive
};
