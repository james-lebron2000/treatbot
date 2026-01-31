const logger = require('../utils/logger');
const trialCache = require('./trialCache');
const retrievalService = require('./trialRetrievalService');

const SESSION_TTL_MS = Number(process.env.MATCH_SESSION_TTL_MS || 15 * 60 * 1000);

/**
 * 增强版临床试验匹配引擎
 * 基于分步提取的结构化数据进行精确匹配
 */
class TrialMatchingEngine {
  constructor() {
    this.trialsData = [];
    this.matchingRules = this.initializeMatchingRules();
    this.loadPromise = null;
    this.trialIndex = new Map();
    this.batchSessions = new Map();
  }

  async ensureTrialsLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = trialCache.loadTrials()
        .then((trials) => {
          logger.info({ trialsCount: trials.length }, '临床试验数据加载成功');
          this.trialsData = trials;
          this.trialIndex = new Map(trials.map((trial) => [trial.项目编码, trial]));
          return trials;
        })
        .catch((error) => {
          logger.error({ err: error }, '加载临床试验数据失败');
          this.trialsData = [];
          this.loadPromise = null;
          throw error;
        });
    }
    try {
      await this.loadPromise;
    } catch (err) {
      // ensure next call retries
      this.loadPromise = null;
      throw err;
    }
  }

  /**
   * 初始化匹配规则权重系统
   */
  initializeMatchingRules() {
    return {
      // 硬性排除条件 - 不满足直接排除
      hardExclusions: [
        { field: 'age', type: 'range' },
        { field: 'pregnancy_status', type: 'exclude_if' },
        { field: 'major_contraindications', type: 'exclude_if' }
      ],
      
      // 加权评分条件
      scoringCriteria: [
        { category: 'demographics', weight: 10, fields: ['age', 'gender'] },
        { category: 'diagnosis', weight: 25, fields: ['primary_diagnosis', 'staging_value', 'pathology_type'] },
        { category: 'performance_status', weight: 15, fields: ['ecog_score'] },
        { category: 'lab_values', weight: 20, fields: ['blood_counts', 'liver_function', 'kidney_function'] },
        { category: 'treatment_history', weight: 15, fields: ['total_treatment_lines', 'previous_treatments'] },
        { category: 'biomarkers', weight: 10, fields: ['molecular_testing', 'pd_l1_status'] },
        { category: 'comorbidities', weight: 5, fields: ['viral_hepatitis', 'cardiovascular', 'active_infections'] }
      ]
    };
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.batchSessions.entries()) {
      if (session.expiresAt && session.expiresAt <= now) {
        this.batchSessions.delete(sessionId);
      }
    }
  }

  getBatchSession(sessionId) {
    if (!sessionId) {
      return null;
    }
    this.cleanupExpiredSessions();
    return this.batchSessions.get(sessionId) || null;
  }

  async createBatchSession(structuredPatientData, patientId, sessionId, options = {}) {
    await this.ensureTrialsLoaded();
    const baseSessionId = sessionId || patientId || `session-${Date.now()}`;
    const candidateTrials = this.selectCandidateTrials(structuredPatientData);
    const allowedTrialIds = Array.isArray(options.allowedTrialIds) ? options.allowedTrialIds : null;
    const allowedSet = allowedTrialIds ? new Set(allowedTrialIds.map((id) => String(id))) : null;
    const filteredCandidates = allowedSet
      ? candidateTrials.filter((trial) => allowedSet.has(String(trial?.项目编码 || '')))
      : candidateTrials;
    const candidateIds = filteredCandidates.map((trial) => trial.项目编码);
    const session = {
      id: baseSessionId,
      patientId,
      candidateIds,
      totalCandidates: candidateIds.length,
      createdAt: Date.now(),
      lastOffset: 0,
      batchSize: null,
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    this.batchSessions.set(baseSessionId, session);
    return session;
  }

  clearBatchSession(sessionId) {
    if (!sessionId) {
      return;
    }
    this.batchSessions.delete(sessionId);
  }

  /**
   * 执行患者与试验匹配
   * @param {Object} structuredPatientData - 分步提取的结构化患者数据
   * @param {string} patientId - 患者ID
   * @returns {Promise<Array>} 匹配结果数组
   */
  async matchPatient(structuredPatientData, patientId, options = {}) {
    const {
      offset = 0,
      limit = null,
      sessionId,
      initialize = false
    } = options;

    const batchMode = sessionId || initialize || typeof limit === 'number' || offset > 0;

    await this.ensureTrialsLoaded();

    if (!this.trialsData || this.trialsData.length === 0) {
      logger.warn('临床试验数据为空');
      return batchMode
        ? {
            sessionId: sessionId || null,
            batchNumber: 0,
            totalBatches: 0,
            totalCandidates: 0,
            processedCount: 0,
            offset: 0,
            limit: limit || 0,
            remainingCandidates: 0,
            hasMore: false,
            results: []
          }
        : [];
    }

    if (!batchMode) {
      logger.info({ patientId }, '开始执行临床试验匹配');
      const candidateTrials = this.selectCandidateTrials(structuredPatientData);
      logger.debug({
        patientId,
        candidates: candidateTrials.length,
        totalTrials: this.trialsData.length
      }, '预筛选候选临床试验');

      const matchingResults = [];

      for (const trial of candidateTrials) {
        try {
          const matchResult = await this.evaluateTrialMatch(structuredPatientData, trial);
          if (matchResult) {
            matchingResults.push(matchResult);
          }
        } catch (error) {
          logger.error({ err: error, trialId: trial.项目编码, patientId }, '单个试验匹配评估失败');
        }
      }

      matchingResults.sort((a, b) => b.matchScore - a.matchScore);

      logger.info({
        patientId,
        totalTrials: this.trialsData.length,
        matchedTrials: matchingResults.length,
        topScore: matchingResults[0]?.matchScore || 0
      }, '临床试验匹配完成');
      return matchingResults;
    }

    const effectiveSessionId = sessionId || patientId || `session-${Date.now()}`;
    let session = this.getBatchSession(effectiveSessionId);
    if (!session || initialize) {
      session = await this.createBatchSession(structuredPatientData, patientId, effectiveSessionId);
    }

    const totalCandidates = session.totalCandidates;
    const batchSize = limit && limit > 0 ? limit : (session.batchSize && session.batchSize > 0 ? session.batchSize : totalCandidates);
    session.batchSize = batchSize;

    const startIndex = Math.max(0, offset || session.lastOffset || 0);
    const endIndex = Math.min(totalCandidates, startIndex + batchSize);
    const sliceIds = session.candidateIds.slice(startIndex, endIndex);
    const batchResults = [];

    for (const trialId of sliceIds) {
      const trial = this.trialIndex.get(trialId);
      if (!trial) {
        continue;
      }
      try {
        const matchResult = await this.evaluateTrialMatch(structuredPatientData, trial);
        if (matchResult) {
          batchResults.push(matchResult);
        }
      } catch (error) {
        logger.error({ err: error, trialId, patientId }, '批处理单个试验匹配失败');
      }
    }

    batchResults.sort((a, b) => b.matchScore - a.matchScore);

    session.lastOffset = endIndex;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.batchSessions.set(effectiveSessionId, session);

    const totalBatches = batchSize > 0 ? Math.max(1, Math.ceil(totalCandidates / batchSize)) : 1;
    const batchNumber = batchSize > 0 ? Math.min(totalBatches, Math.floor(startIndex / batchSize) + 1) : 1;
    const hasMore = endIndex < totalCandidates;
    const remainingCandidates = Math.max(0, totalCandidates - endIndex);

    if (!hasMore) {
      this.clearBatchSession(effectiveSessionId);
    }

    logger.info({
      patientId,
      sessionId: effectiveSessionId,
      batchNumber,
      totalBatches,
      processed: endIndex,
      remaining: remainingCandidates
    }, '批次临床试验匹配完成');

    return {
      sessionId: effectiveSessionId,
      batchNumber,
      totalBatches,
      totalCandidates,
      processedCount: endIndex,
      offset: startIndex,
      limit: batchSize,
      remainingCandidates,
      hasMore,
      results: batchResults
    };
  }

  selectCandidateTrials(patientData = {}) {
    const candidates = retrievalService.selectCandidates(patientData, this.trialsData);
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates;
    }
    return this.trialsData;
  }

  /**
   * 评估单个试验的匹配度
   * @param {Object} patientData - 患者数据
   * @param {Object} trial - 试验数据
   * @returns {Object|null} 匹配结果
   */
  async evaluateTrialMatch(patientData, trial) {
    // 步骤1: 硬性排除条件检查
    const hardExclusionResult = this.checkHardExclusions(patientData, trial);
    if (hardExclusionResult.isExcluded) {
      return {
        trialId: trial.项目编码,
        trialName: trial.项目名称,
        matchScore: 0,
        matchLevel: 'Not a Match',
        exclusionReason: hardExclusionResult.reason,
        detailedAnalysis: hardExclusionResult.details,
        summary: `患者不符合试验的硬性排除条件: ${hardExclusionResult.reason}`
      };
    }

    // 步骤2: 分类别评分
    const scoringResults = this.calculateCategoryScores(patientData, trial);
    const totalScore = scoringResults.reduce((sum, cat) => sum + cat.score, 0);
    const maxPossibleScore = this.matchingRules.scoringCriteria.reduce((sum, cat) => sum + cat.weight, 0);
    const matchScore = Math.round((totalScore / maxPossibleScore) * 100);

    // 步骤3: 确定匹配等级
    const matchLevel = this.determineMatchLevel(matchScore, scoringResults);

    // 步骤4: 识别匹配障碍
    const barriers = this.identifyMatchingBarriers(patientData, trial, scoringResults);

    return {
      trialId: trial.项目编码,
      trialName: trial.项目名称,
      matchScore,
      matchLevel,
      summary: this.generateMatchSummary(matchLevel, matchScore, barriers),
      matchingBarriers: barriers,
      detailedAnalysis: scoringResults.map(cat => ({
        category: cat.category,
        score: cat.score,
        maxScore: cat.weight,
        percentage: Math.round((cat.score / cat.weight) * 100),
        details: cat.details
      })),
      trialInfo: {
        phase: trial.分期试验阶段,
        treatment: trial.试验组治疗方案,
        diseaseTags: trial.疾病三级标签,
        centers: trial.研究中心所在城市
      }
    };
  }

  /**
   * 硬性排除条件检查
   * @param {Object} patientData - 患者数据
   * @param {Object} trial - 试验数据
   * @returns {Object} 排除检查结果
   */
  checkHardExclusions(patientData, trial) {
    const exclusions = [];
    const eligibilityIndex = this.getStructuredEligibilityIndex(trial);

    // 年龄检查
    if (patientData.age) {
      const ageRequirements = this.extractAgeRequirements(trial);
      if (ageRequirements.min && patientData.age < ageRequirements.min) {
        exclusions.push(`年龄不符合要求 (需要≥${ageRequirements.min}岁，患者${patientData.age}岁)`);
      }
      if (ageRequirements.max && patientData.age > ageRequirements.max) {
        exclusions.push(`年龄不符合要求 (需要≤${ageRequirements.max}岁，患者${patientData.age}岁)`);
      }
    }

    // 妊娠/哺乳期排除
    if (this.hasStructuredIntent(eligibilityIndex, 'pregnancy', 'exclusion')
      && this.isPregnantOrLactating(patientData)) {
      exclusions.push('妊娠或哺乳期妇女被排除');
    } else if (patientData.pregnancy_status === '妊娠' || patientData.pregnancy_status === '哺乳') {
      const exclusionText = trial.排除条件 || '';
      if (exclusionText.includes('妊娠') || exclusionText.includes('哺乳')) {
        exclusions.push('妊娠或哺乳期妇女被排除');
      }
    }

    // HBV 活动性感染排除
    if (this.hasStructuredIntent(eligibilityIndex, 'hbv', 'exclusion')) {
      const hbvStatus = this.getPatientHBVStatus(patientData);
      if (hbvStatus && this.indicatesActiveHBV(hbvStatus)) {
        exclusions.push(`HBV 状态不符合要求 (${hbvStatus})`);
      }
    }

    // 中枢神经系统转移排除
    if (this.hasStructuredIntent(eligibilityIndex, 'cns', 'exclusion')
      && this.hasCNSMetastasis(patientData)) {
      exclusions.push('存在中枢神经系统/脑广泛转移，被排除');
    }

    // 诊断匹配检查
    if (patientData.primary_diagnosis) {
      const diagnosisMatch = this.checkDiagnosisMatch(patientData.primary_diagnosis, trial.疾病三级标签);
      if (!diagnosisMatch.isMatch) {
        exclusions.push(`主要诊断不匹配 (患者: ${patientData.primary_diagnosis})`);
      }
    }

    return {
      isExcluded: exclusions.length > 0,
      reason: exclusions.join('; '),
      details: exclusions
    };
  }

  /**
   * 提取年龄要求
   */
  extractAgeRequirements(trial) {
    const structured = this.getStructuredNumericBound(trial, 'age');
    if (structured.min || structured.max) {
      return {
        min: structured.min || null,
        max: structured.max || null
      };
    }

    const inclusionText = trial.入组条件 || '';
    const ageRegex = /年龄.*?≥\s*(\d+).*?≤\s*(\d+)|年龄.*?(\d+)\s*-\s*(\d+)|≥\s*(\d+).*?≤\s*(\d+)/;
    const match = inclusionText.match(ageRegex);

    if (match) {
      const min = parseInt(match[1] || match[3] || match[5], 10) || null;
      const max = parseInt(match[2] || match[4] || match[6], 10) || null;
      return { min, max };
    }

    return { min: null, max: null };
  }

  /**
   * 检查诊断匹配
   */
  checkDiagnosisMatch(patientDiagnosis, trialDiseaseTags) {
    if (!trialDiseaseTags) {
      return { isMatch: false, details: '试验无疾病标签信息' };
    }

    const normalizedPatientDx = patientDiagnosis.toLowerCase();
    const normalizedTrialTags = trialDiseaseTags.toLowerCase();

    // 肝细胞癌匹配
    if (normalizedPatientDx.includes('肝细胞癌') || normalizedPatientDx.includes('肝癌')) {
      if (normalizedTrialTags.includes('肝细胞癌') || normalizedTrialTags.includes('实体瘤')) {
        return { isMatch: true, details: '肝细胞癌匹配成功' };
      }
    }

    // 肺癌匹配
    if (normalizedPatientDx.includes('肺癌') || normalizedPatientDx.includes('非小细胞肺癌')) {
      if (normalizedTrialTags.includes('肺癌') || normalizedTrialTags.includes('非小细胞肺癌') || normalizedTrialTags.includes('实体瘤')) {
        return { isMatch: true, details: '肺癌匹配成功' };
      }
    }

    // 胃癌匹配
    if (normalizedPatientDx.includes('胃癌')) {
      if (normalizedTrialTags.includes('胃癌') || normalizedTrialTags.includes('实体瘤')) {
        return { isMatch: true, details: '胃癌匹配成功' };
      }
    }

    // 实体瘤通配
    if (normalizedTrialTags.includes('全部实体瘤') || normalizedTrialTags.includes('实体瘤')) {
      return { isMatch: true, details: '实体瘤通配匹配' };
    }

    return { isMatch: false, details: '诊断类型不匹配' };
  }

  /**
   * 计算分类别得分
   */
  calculateCategoryScores(patientData, trial) {
    return this.matchingRules.scoringCriteria.map(category => {
      let score = 0;
      const details = [];

      switch (category.category) {
        case 'demographics':
          score = this.scoreDemographics(patientData, trial, details);
          break;
        case 'diagnosis':
          score = this.scoreDiagnosis(patientData, trial, details);
          break;
        case 'performance_status':
          score = this.scorePerformanceStatus(patientData, trial, details);
          break;
        case 'lab_values':
          score = this.scoreLabValues(patientData, trial, details);
          break;
        case 'treatment_history':
          score = this.scoreTreatmentHistory(patientData, trial, details);
          break;
        case 'biomarkers':
          score = this.scoreBiomarkers(patientData, trial, details);
          break;
        case 'comorbidities':
          score = this.scoreComorbidities(patientData, trial, details);
          break;
      }

      return {
        category: category.category,
        weight: category.weight,
        score: Math.min(score, category.weight), // 确保不超过权重
        details
      };
    });
  }

  /**
   * 人口学特征评分
   */
  scoreDemographics(patientData, trial, details) {
    let score = 0;
    const maxScore = 10;

    // 年龄匹配 (5分)
    if (patientData.age) {
      const ageReq = this.extractAgeRequirements(trial);
      if (ageReq.min && ageReq.max) {
        if (patientData.age >= ageReq.min && patientData.age <= ageReq.max) {
          score += 5;
          details.push(`年龄符合要求 (${patientData.age}岁在${ageReq.min}-${ageReq.max}岁范围内)`);
        } else {
          details.push(`年龄不符合要求 (${patientData.age}岁不在${ageReq.min}-${ageReq.max}岁范围内)`);
        }
      }
    }

    // 性别匹配 (5分)
    const inclusionText = trial.入组条件 || '';
    if (inclusionText.includes('性别不限') || !inclusionText.match(/仅限.*[男女]/)) {
      score += 5;
      details.push('性别要求: 不限');
    } else if (patientData.gender) {
      if (inclusionText.includes(`仅限${patientData.gender}性`) || inclusionText.includes(patientData.gender)) {
        score += 5;
        details.push(`性别符合要求 (${patientData.gender})`);
      } else {
        details.push(`性别不符合要求`);
      }
    }

    return score;
  }

  /**
   * 诊断相关评分
   */
  scoreDiagnosis(patientData, trial, details) {
    let score = 0;
    const maxScore = 25;

    // 主要诊断匹配 (15分)
    if (patientData.primary_diagnosis) {
      const diagnosisMatch = this.checkDiagnosisMatch(patientData.primary_diagnosis, trial.疾病三级标签);
      if (diagnosisMatch.isMatch) {
        score += 15;
        details.push(diagnosisMatch.details);
      } else {
        details.push(diagnosisMatch.details);
      }
    }

    // 分期匹配 (5分)
    if (patientData.staging_value) {
      const inclusionText = trial.入组条件 || '';
      if (inclusionText.includes('晚期') || inclusionText.includes('转移') || inclusionText.includes('不可切除')) {
        if (patientData.staging_value.includes('III') || patientData.staging_value.includes('IV') || 
            patientData.metastasis_sites?.length > 0) {
          score += 5;
          details.push('分期符合晚期要求');
        }
      }
    }

    // 可测量病灶 (5分)
    if (patientData.measurable_lesions === true) {
      const inclusionText = trial.入组条件 || '';
      if (inclusionText.includes('可测量病灶') || inclusionText.includes('RECIST')) {
        score += 5;
        details.push('符合可测量病灶要求');
      }
    }

    return score;
  }

  /**
   * 体能状态评分
   */
  scorePerformanceStatus(patientData, trial, details) {
    let score = 0;
    const maxScore = 15;

    if (patientData.ecog_score !== null && patientData.ecog_score !== undefined) {
      const inclusionText = trial.入组条件 || '';

      const ecogRequirement = this.getStructuredNumericBound(trial, 'ecog');
      if (ecogRequirement.max !== null && ecogRequirement.max !== undefined) {
        if (patientData.ecog_score <= ecogRequirement.max) {
          score += 15;
          details.push(`ECOG评分符合要求 (${patientData.ecog_score}≤${ecogRequirement.max})`);
        } else {
          details.push(`ECOG评分不符合要求 (${patientData.ecog_score}>${ecogRequirement.max})`);
        }
      } else if (inclusionText.includes('ECOG') && inclusionText.includes('≤1')) {
        if (patientData.ecog_score <= 1) {
          score += 15;
          details.push(`ECOG评分符合要求 (${patientData.ecog_score}≤1)`);
        } else {
          details.push(`ECOG评分不符合要求 (${patientData.ecog_score}>1)`);
        }
      } else if (inclusionText.includes('ECOG') && inclusionText.includes('≤2')) {
        if (patientData.ecog_score <= 2) {
          score += 15;
          details.push(`ECOG评分符合要求 (${patientData.ecog_score}≤2)`);
        } else {
          details.push(`ECOG评分不符合要求 (${patientData.ecog_score}>2)`);
        }
      }
    } else {
      details.push('ECOG评分信息缺失');
    }

    return score;
  }

  /**
   * 实验室指标评分
   */
  scoreLabValues(patientData, trial, details) {
    let score = 0;
    const maxScore = 20;

    if (patientData.blood_counts) {
      let labScore = 0;

      // 血红蛋白
      if (patientData.blood_counts.hemoglobin) {
        const hbRequirement = this.getStructuredNumericBound(trial, 'hemoglobin');
        const hbThreshold = hbRequirement.min || 90;
        if (patientData.blood_counts.hemoglobin >= hbThreshold) {
          labScore += 3;
          details.push(`血红蛋白符合要求 (${patientData.blood_counts.hemoglobin}g/L≥${hbThreshold})`);
        } else {
          details.push(`血红蛋白不足 (${patientData.blood_counts.hemoglobin}g/L<${hbThreshold})`);
        }
      }

      // 中性粒细胞
      if (patientData.blood_counts.anc) {
        const ancRequirement = this.getStructuredNumericBound(trial, 'neutrophil');
        const ancThreshold = ancRequirement.min || 1.5;
        if (patientData.blood_counts.anc >= ancThreshold) {
          labScore += 3;
          details.push(`中性粒细胞符合要求 (${patientData.blood_counts.anc}×10⁹/L≥${ancThreshold})`);
        } else {
          details.push(`中性粒细胞不足 (${patientData.blood_counts.anc}×10⁹/L<${ancThreshold})`);
        }
      }

      // 血小板
      if (patientData.blood_counts.platelet) {
        const plateletBound = this.getStructuredNumericBound(trial, 'platelet');
        const plateletRequirement = plateletBound.min || (trial.项目名称?.includes('肝细胞癌') ? 75 : 90);
        if (patientData.blood_counts.platelet >= plateletRequirement) {
          labScore += 4;
          details.push(`血小板符合要求 (${patientData.blood_counts.platelet}×10⁹/L≥${plateletRequirement})`);
        } else {
          details.push(`血小板不足 (${patientData.blood_counts.platelet}×10⁹/L<${plateletRequirement})`);
        }
      }

      score += labScore;
    }

    // 肝功能评分 (10分)
      if (patientData.liver_function) {
        let liverScore = 0;
        const isHCC = patientData.primary_diagnosis?.includes('肝');
        const altRequirement = this.getStructuredNumericBound(trial, 'alt');
        const altLimit = altRequirement.max || (isHCC ? 250 : 150);

        if (patientData.liver_function.alt && patientData.liver_function.alt <= altLimit) {
          liverScore += 5;
          details.push(`ALT符合要求 (≤${altLimit}${altRequirement.unit ? altRequirement.unit : ''})`);
        }

        const tbilBound = this.getStructuredNumericBound(trial, 'bilirubin');
        const tbilLimit = tbilBound.max || (isHCC ? 46 : 34.5);
        if (patientData.liver_function.tbil && patientData.liver_function.tbil <= tbilLimit) {
          liverScore += 5;
          details.push(`总胆红素符合要求 (≤${tbilLimit}${tbilBound.unit ? tbilBound.unit : ''})`);
        }

        score += liverScore;
      }

    if (patientData.kidney_function) {
      let renalScore = 0;
      const creatinineBound = this.getStructuredNumericBound(trial, 'creatinine');
      const creatinineLimit = creatinineBound.max || 120;
      if (patientData.kidney_function.creatinine
        && patientData.kidney_function.creatinine <= creatinineLimit) {
        renalScore += 2;
        details.push(`肌酐符合要求 (≤${creatinineLimit}${creatinineBound.unit ? creatinineBound.unit : ''})`);
      }

      const ureaBound = this.getStructuredNumericBound(trial, 'urea');
      const ureaLimit = ureaBound.max || 9;
      if (patientData.kidney_function.urea
        && patientData.kidney_function.urea <= ureaLimit) {
        renalScore += 1;
        details.push(`尿素符合要求 (≤${ureaLimit}${ureaBound.unit ? ureaBound.unit : ''})`);
      }

      score += renalScore;
    }

    return Math.min(score, maxScore);
  }

  getStructuredEligibilityIndex(trial) {
    if (!trial) return { inclusion: {}, exclusion: {} };
    if (trial._eligibilityIndex) {
      return trial._eligibilityIndex;
    }
    const index = { inclusion: {}, exclusion: {} };
    const structured = trial.structuredEligibility || {};
    ['inclusion', 'exclusion'].forEach((type) => {
      const list = structured[type];
      if (!Array.isArray(list)) {
        return;
      }
      list.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const intent = entry.intent || 'general';
        if (!index[type][intent]) {
          index[type][intent] = [];
        }
        index[type][intent].push(entry);
      });
    });
    trial._eligibilityIndex = index;
    return index;
  }

  getStructuredNumericBound(trial, intent, type = 'inclusion') {
    const index = this.getStructuredEligibilityIndex(trial);
    const entries = index?.[type]?.[intent] || [];
    let min = null;
    let max = null;
    let unit = null;
    entries.forEach((entry) => {
      const numeric = entry.numeric;
      if (!numeric) return;
      const normalized = this.normalizeNumericBound(numeric);
      if (normalized.unit && !unit) {
        unit = normalized.unit;
      }
      if (normalized.min !== null && normalized.min !== undefined) {
        min = min === null ? normalized.min : Math.max(min, normalized.min);
      }
      if (normalized.max !== null && normalized.max !== undefined) {
        max = max === null ? normalized.max : Math.min(max, normalized.max);
      }
    });
    return { min, max, unit };
  }

  normalizeNumericBound(numeric) {
    const unit = numeric.unit || null;
    const isULN = unit && /ULN/i.test(unit);
    const toNumberSafe = (value) => {
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const min = isULN ? null : toNumberSafe(numeric.min);
    const max = isULN ? null : toNumberSafe(numeric.max);
    return { min, max, unit: isULN ? unit : unit || null };
  }

  hasStructuredIntent(index, intent, type) {
    if (!index) return false;
    const entries = index?.[type]?.[intent];
    return Array.isArray(entries) && entries.length > 0;
  }

  isPregnantOrLactating(patientData = {}) {
    const status = (patientData.pregnancy_status || patientData.pregnancyStatus || '').toString();
    if (!status) return false;
    return /(妊娠|怀孕|孕|哺乳|pregnant|lact)/i.test(status);
  }

  getPatientHBVStatus(patientData = {}) {
    const status = patientData.viral_hepatitis?.hbv_status
      || patientData.viral_hepatitis?.status
      || patientData.hbv_status
      || patientData.hbv
      || patientData?.infection?.hbv_status
      || patientData?.infection?.hbv
      || '';
    return status ? status.toString() : '';
  }

  indicatesActiveHBV(statusText) {
    const lower = statusText.toLowerCase();
    if (!lower) return false;
    if (/(阴性|negative|抑制|undetect)/.test(lower)) {
      return false;
    }
    return /(阳性|positive|dna|>\s*0|活动)/.test(lower);
  }

  hasCNSMetastasis(patientData = {}) {
    const sites = patientData.metastasis_sites
      || patientData.metastasisSites
      || patientData.metastases
      || [];
    const normalized = Array.isArray(sites) ? sites : [sites];
    return normalized.some((site) => /脑|cns|脑膜|神经/i.test(String(site)));
  }

  /**
   * 治疗史评分
   */
  scoreTreatmentHistory(patientData, trial, details) {
    let score = 0;
    const maxScore = 15;

    if (patientData.total_treatment_lines) {
      const trialLines = trial.治疗线数;
      const inclusionText = trial.入组条件 || '';
      
      // 解析试验要求的治疗线数
      let requiredLines = null;
      if (trialLines && trialLines.includes(',')) {
        const lines = trialLines.split(',').map(l => parseInt(l.trim()));
        if (lines.includes(patientData.total_treatment_lines)) {
          score += 10;
          details.push(`治疗线数匹配 (${patientData.total_treatment_lines}线)`);
        }
      } else if (inclusionText.includes('≥2L') || inclusionText.includes('二线')) {
        if (patientData.total_treatment_lines >= 2) {
          score += 10;
          details.push(`治疗线数符合要求 (${patientData.total_treatment_lines}线≥2线)`);
        }
      } else if (inclusionText.includes('≥3L') || inclusionText.includes('三线')) {
        if (patientData.total_treatment_lines >= 3) {
          score += 10;
          details.push(`治疗线数符合要求 (${patientData.total_treatment_lines}线≥3线)`);
        }
      }

      // 检查特定治疗药物使用史 (5分)
      if (patientData.systemic_treatments) {
        const usedDrugs = patientData.systemic_treatments
          .flatMap(t => t.regimen || [])
          .map(drug => drug.toLowerCase());
        
        let drugMatchScore = 0;
        if (inclusionText.includes('PD-1') || inclusionText.includes('PD-L1')) {
          const hasImmunoTherapy = usedDrugs.some(drug => 
            drug.includes('信迪利单抗') || drug.includes('百泽安') || drug.includes('替雷利珠单抗')
          );
          if (hasImmunoTherapy) {
            drugMatchScore += 2;
            details.push('既往使用过免疫治疗');
          }
        }
        
        if (inclusionText.includes('TKI') || inclusionText.includes('靶向')) {
          const hasTargetedTherapy = usedDrugs.some(drug => 
            drug.includes('仑伐替尼') || drug.includes('索拉非尼') || drug.includes('瑞戈非尼')
          );
          if (hasTargetedTherapy) {
            drugMatchScore += 3;
            details.push('既往使用过靶向治疗');
          }
        }
        
        score += drugMatchScore;
      }
    }

    return Math.min(score, maxScore);
  }

  /**
   * 生物标志物评分
   */
  scoreBiomarkers(patientData, trial, details) {
    let score = 0;
    const maxScore = 10;

    // PD-L1表达 (5分)
    if (patientData.pd_l1_status && patientData.pd_l1_status.expression) {
      const inclusionText = trial.入组条件 || '';
      if (inclusionText.includes('PD-L1') && patientData.pd_l1_status.expression === '阳性') {
        score += 5;
        details.push(`PD-L1阳性 (CPS=${patientData.pd_l1_status.cps_score || '未知'})`);
      }
    }

    // MSI/MMR状态 (5分)
    if (patientData.msi_mmr_status) {
      const inclusionText = trial.入组条件 || '';
      if ((inclusionText.includes('MSI-H') || inclusionText.includes('dMMR')) &&
          (patientData.msi_mmr_status.msi_status === 'MSI-H' || 
           patientData.msi_mmr_status.mmr_status === 'dMMR')) {
        score += 5;
        details.push('MSI-H/dMMR阳性');
      }
    }

    return score;
  }

  /**
   * 合并症评分
   */
  scoreComorbidities(patientData, trial, details) {
    let score = 0;
    const maxScore = 5;

    // 病毒性肝炎状态
    if (patientData.viral_hepatitis) {
      if (patientData.viral_hepatitis.hbv_status === '阳性') {
        const exclusionText = trial.排除条件 || '';
        if (!exclusionText.includes('活动性乙肝') || patientData.viral_hepatitis.antiviral_treatment) {
          score += 3;
          details.push('乙肝病毒感染可控');
        } else {
          details.push('存在活动性乙肝风险');
        }
      } else {
        score += 3;
        details.push('无乙肝病毒感染');
      }
    }

    // 心血管疾病
    if (patientData.cardiovascular) {
      if (!patientData.cardiovascular.heart_failure && !patientData.cardiovascular.coronary_disease) {
        score += 2;
        details.push('无严重心血管疾病');
      } else if (patientData.cardiovascular.controlled) {
        score += 1;
        details.push('心血管疾病控制良好');
      }
    }

    return Math.min(score, maxScore);
  }

  /**
   * 确定匹配等级
   */
  determineMatchLevel(matchScore, scoringResults) {
    if (matchScore >= 85) {
      return 'Excellent Match';
    } else if (matchScore >= 70) {
      return 'Potential Match';
    } else if (matchScore >= 50) {
      return 'Possible Match';
    } else {
      return 'Unlikely Match';
    }
  }

  /**
   * 识别匹配障碍
   */
  identifyMatchingBarriers(patientData, trial, scoringResults) {
    const barriers = [];

    scoringResults.forEach(category => {
      const scorePercentage = (category.score / category.weight) * 100;
      if (scorePercentage < 50) {
        category.details.forEach(detail => {
          if (detail.includes('不符合') || detail.includes('不足') || detail.includes('缺失')) {
            barriers.push({
              category: category.category,
              issue: detail,
              severity: scorePercentage < 25 ? 'High' : 'Medium'
            });
          }
        });
      }
    });

    return barriers;
  }

  /**
   * 生成匹配总结
   */
  generateMatchSummary(matchLevel, matchScore, barriers) {
    const majorBarriers = barriers.filter(b => b.severity === 'High').length;
    const minorBarriers = barriers.filter(b => b.severity === 'Medium').length;

    if (matchLevel === 'Excellent Match') {
      return `患者与试验高度匹配 (${matchScore}%)，满足所有关键入组标准。`;
    } else if (matchLevel === 'Potential Match') {
      return `患者与试验有较好的匹配度 (${matchScore}%)，${minorBarriers > 0 ? `存在${minorBarriers}个次要需要确认的项目` : '基本符合入组条件'}。`;
    } else if (matchLevel === 'Possible Match') {
      return `患者与试验存在一定匹配度 (${matchScore}%)，需要解决${majorBarriers}个主要问题和${minorBarriers}个次要问题。`;
    } else {
      return `患者与试验匹配度较低 (${matchScore}%)，存在${majorBarriers}个主要障碍需要克服。`;
    }
  }

  /**
   * 获取引擎统计信息
   */
  async getEngineStats() {
    try {
      await this.ensureTrialsLoaded();
    } catch (err) {
      logger.error({ err }, '获取临床试验统计信息失败');
    }
    return {
      totalTrials: this.trialsData.length,
      matchingRules: {
        hardExclusionRules: this.matchingRules.hardExclusions.length,
        scoringCategories: this.matchingRules.scoringCriteria.length,
        totalWeight: this.matchingRules.scoringCriteria.reduce((sum, cat) => sum + cat.weight, 0)
      },
      lastUpdated: new Date().toISOString()
    };
  }
}

module.exports = TrialMatchingEngine;
