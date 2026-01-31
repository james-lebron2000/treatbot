const { extractPatientFeatures, normaliseStage } = require('./matching/featureNormalizer');

const DEFAULT_LIMIT = 80;

function splitChineseTokens(text) {
  return text
    .replace(/[\s、，,；;()（）]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function derivePatientTokens(patientData = {}, features = {}) {
  const tokens = new Set();
  const diagnosisCandidates = [
    patientData.primary_diagnosis,
    patientData.primaryDiagnosis,
    patientData.diagnosis,
    patientData.primary_diagnoses,
    patientData?.疾病名称
  ];

  diagnosisCandidates.forEach((value) => {
    if (!value) return;
    splitChineseTokens(String(value)).forEach((token) => tokens.add(token));
  });

  const labelCandidates = patientData?.disease_labels || patientData?.疾病三级标签 || [];
  if (Array.isArray(labelCandidates)) {
    labelCandidates.forEach((label) => {
      splitChineseTokens(String(label)).forEach((token) => tokens.add(token));
    });
  }

  const biomarkers = patientData?.molecular_testing || patientData?.biomarkers;
  if (biomarkers && typeof biomarkers === 'object') {
    Object.entries(biomarkers).forEach(([marker, value]) => {
      if (value) {
        tokens.add(String(marker).toLowerCase());
      }
    });
  }

  if (features?.therapyCategories instanceof Set) {
    features.therapyCategories.forEach((category) => tokens.add(String(category)));
  }

  if (features?.biomarkers instanceof Map) {
    features.biomarkers.forEach((value, marker) => {
      tokens.add(marker);
      if (value.includes('阳性') || value.includes('positive')) {
        tokens.add(`${marker}_positive`);
      }
      if (value.includes('阴性') || value.includes('negative')) {
        tokens.add(`${marker}_negative`);
      }
    });
  }

  if (Array.isArray(features?.diseaseLabels)) {
    features.diseaseLabels.forEach((label) => {
      splitChineseTokens(String(label)).forEach((token) => tokens.add(token));
    });
  }

  return tokens;
}

function getTrialTokens(trial = {}) {
  if (Array.isArray(trial.diseaseTokens) && trial.diseaseTokens.length > 0) {
    return new Set(trial.diseaseTokens.map((token) => token.trim()).filter(Boolean));
  }
  const labelText = trial.疾病三级标签 || trial.diseaseTags || '';
  return new Set(splitChineseTokens(String(labelText)));
}

function trialMatchesStage(trial, keyword) {
  if (!keyword) return true;
  const inclusion = String(trial.入组条件 || trial.inclusionText || '');
  const brief = String(trial.简要入组条件 || '');
  if (keyword === 'advanced') {
    return /(晚期|转移|不可切除|IV|四期|终末|复发|多发)/.test(inclusion + brief);
  }
  if (keyword === 'locally_advanced') {
    return /(III|3期|局部晚期|不可切除)/.test(inclusion + brief);
  }
  if (keyword === 'early') {
    return /(I|II|1期|2期|早期|术后|辅助)/.test(inclusion + brief) && !/(晚期|IV|转移)/.test(inclusion + brief);
  }
  return true;
}

function computeTokenScore(patientTokens, trialTokens) {
  if (patientTokens.size === 0) return 0.5; // Partial score when no tokens (rough matching)
  let overlap = 0;
  patientTokens.forEach((token) => {
    if (trialTokens.has(token)) {
      overlap += 1;
    }
  });
  if (overlap === 0) return 0;
  return overlap / Math.min(trialTokens.size || 1, patientTokens.size);
}

function computeTherapyScore(patientData, trial, features) {
  const therapies = Array.isArray(trial.therapies) ? trial.therapies : [];
  if (therapies.length === 0) return 0;
  const historySet = features?.therapyDrugs instanceof Set ? features.therapyDrugs : null;
  let history = [];
  if (historySet && historySet.size > 0) {
    history = Array.from(historySet);
  } else {
    history = (
      patientData?.systemic_treatments
      || patientData?.treatments
      || []
    ).flatMap((item) => item?.regimen || item?.drugList || item?.drugs || []);
  }
  if (!Array.isArray(history) || history.length === 0) {
    return 0;
  }
  const lowerHistory = history.map((name) => String(name).toLowerCase());
  let matches = 0;
  therapies.forEach((therapy) => {
    const t = therapy.toLowerCase();
    if (lowerHistory.some((drug) => drug.includes(t))) {
      matches += 1;
    }
  });
  return matches / therapies.length;
}

function scoreTrial(patientData, trial, features) {
  const patientTokens = derivePatientTokens(patientData, features);
  const trialTokens = getTrialTokens(trial);
  const tokenScore = computeTokenScore(patientTokens, trialTokens);

  // 移除早期返回，确保所有试验都能参与评分（粗糙匹配模式）
  // Remove early return to ensure all trials participate in scoring (rough matching mode)

  const stageKeyword = features?.stageKeyword
    || normaliseStage(
      patientData?.staging_value
      || patientData?.stage
      || patientData?.current_status?.stage
    );
  const stageMatch = trialMatchesStage(trial, stageKeyword) ? 1 : 0;

  const therapyScore = computeTherapyScore(patientData, trial, features);
  const statusWeight = trial.项目状态 === '招募中' ? 1.0 : 0.7;

  let biomarkerScore = 0;
  if (features?.biomarkers instanceof Map && features.biomarkers.size > 0) {
    const targetMutations = Array.isArray(trial.靶点) ? trial.靶点 : trial.targetMutations;
    if (Array.isArray(targetMutations) && targetMutations.length > 0) {
      const normalizedTargets = targetMutations.map((mut) => String(mut).toLowerCase());
      features.biomarkers.forEach((value, marker) => {
        if (normalizedTargets.some((target) => target.includes(marker))) {
          biomarkerScore += value.includes('阳性') || value.includes('positive') ? 1 : 0.5;
        }
      });
    }
  }

  // 添加基础分确保最低匹配分数（粗糙匹配模式）
  // Add base score to ensure minimum matching score (rough matching mode)
  const baseScore = 0.2;
  const base = baseScore + tokenScore * 0.4 + stageMatch * 0.2 + therapyScore * 0.1 + Math.min(biomarkerScore, 1) * 0.1;
  return base * statusWeight;
}

function selectCandidates(patientData, trials, limit = DEFAULT_LIMIT) {
  if (!Array.isArray(trials)) return [];
  const features = extractPatientFeatures(patientData);
  const scored = trials
    .map((trial) => ({
      trial,
      score: scoreTrial(patientData, trial, features)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return trials.slice(0, limit);
  }

  return scored.slice(0, limit).map((entry) => entry.trial);
}

/**
 * 分页选择候选试验 - 支持连续匹配 / Paginated candidate selection - supports continuous matching
 * @param {Object} patientData - 患者数据 / Patient data
 * @param {Array} trials - 所有试验 / All trials
 * @param {Object} options - 分页选项 / Pagination options
 * @returns {Object} 分页结果 / Pagination result
 */
function selectCandidatesPaginated(patientData, trials, options = {}) {
  if (!Array.isArray(trials)) return { candidates: [], hasMore: false, total: 0 };

  const {
    offset = 0,
    limit = DEFAULT_LIMIT,
    batchSize = DEFAULT_LIMIT,
    sortBy = 'score',
    minScore = 0
  } = options;

  const features = extractPatientFeatures(patientData);

  // 计算所有试验的得分 / Calculate scores for all trials
  const allScored = trials
    .map((trial, index) => ({
      trial,
      score: scoreTrial(patientData, trial, features),
      originalIndex: index
    }))
    .filter((entry) => entry.score >= minScore);

  // 排序 / Sort
  if (sortBy === 'score') {
    allScored.sort((a, b) => b.score - a.score);
  }

  const totalCount = allScored.length;
  const startIndex = offset;
  const endIndex = Math.min(startIndex + limit, totalCount);

  const candidates = allScored.slice(startIndex, endIndex).map((entry) => entry.trial);
  const hasMore = endIndex < totalCount;
  const nextOffset = hasMore ? endIndex : null;

  return {
    candidates,
    hasMore,
    nextOffset,
    total: totalCount,
    currentOffset: offset,
    currentCount: candidates.length,
    batchSize: Math.min(batchSize, limit)
  };
}

/**
 * 批量处理试验匹配 / Batch process trial matching
 * @param {Object} patientData - 患者数据 / Patient data
 * @param {Array} trials - 试验数组 / Trials array
 * @param {Function} onBatch - 批次处理回调 / Batch processing callback
 * @param {Object} options - 批处理选项 / Batch options
 */
async function processTrialsInBatches(patientData, trials, onBatch, options = {}) {
  const {
    batchSize = 50,
    minScore = 0,
    maxBatches = null, // null表示处理所有批次 / null means process all batches
    delayBetweenBatches = 0 // 批次间延迟(ms) / Delay between batches(ms)
  } = options;

  const features = extractPatientFeatures(patientData);
  const results = [];
  let processedCount = 0;
  let batchCount = 0;

  for (let i = 0; i < trials.length; i += batchSize) {
    const batch = trials.slice(i, i + batchSize);
    const batchResults = batch
      .map((trial, index) => ({
        trial,
        score: scoreTrial(patientData, trial, features),
        originalIndex: i + index
      }))
      .filter((entry) => entry.score >= minScore);

    // 调用回调函数处理批次结果 / Call callback to process batch results
    if (onBatch && typeof onBatch === 'function') {
      await onBatch(batchResults, {
        batchIndex: batchCount,
        totalProcessed: processedCount + batch.length,
        remaining: trials.length - (i + batch.length),
        batchSize: batch.length,
        hasMore: (i + batchSize) < trials.length
      });
    }

    results.push(...batchResults);
    processedCount += batch.length;
    batchCount++;

    // 检查是否达到最大批次限制 / Check if max batches reached
    if (maxBatches && batchCount >= maxBatches) {
      break;
    }

    // 批次间延迟 / Delay between batches
    if (delayBetweenBatches > 0 && (i + batchSize) < trials.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return {
    results,
    totalProcessed: processedCount,
    totalBatches: batchCount,
    totalMatches: results.length
  };
}

module.exports = {
  selectCandidates,
  selectCandidatesPaginated,
  processTrialsInBatches,
  derivePatientTokens,
  getTrialTokens,
  splitChineseTokens,
  trialMatchesStage
};
