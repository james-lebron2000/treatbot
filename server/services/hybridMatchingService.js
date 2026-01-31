const retrievalService = require('./trialRetrievalService');
const TrialMatchingEngine = require('./trialMatchingEngine');
const trialMatchingService = require('./trialMatchingService');
const cacheService = require('./cache');
const logger = require('../utils/logger');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  // Layer 1: 快速检索配置
  retrieval: {
    candidateLimit: 50,  // 从114个筛选到50个
    minTokenScore: 0.1   // 最低token匹配分
  },

  // Layer 2: 规则评分配置
  ruleEngine: {
    minScore: 50,        // 最低匹配分数
    topK: 20             // 保留top 20候选
  },

  // Layer 3: LLM复核配置
  llmReview: {
    enabled: true,
    topK: 15,            // 仅对top 15使用LLM
    minScoreForLLM: 60,  // LLM复核最低分数阈值
    cacheEnabled: true,  // 启用LLM结果缓存
    cacheTTL: 3600 * 24  // 缓存24小时
  }
};

class HybridMatchingService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      layer1Filtered: 0,
      layer2Filtered: 0,
      llmCalled: 0,
      cacheHits: 0
    };
  }

  /**
   * 混合匹配主流程
   */
  async match({ patientData, trials, options = {} }) {
    const startTime = Date.now();
    const config = { ...this.config, ...options };

    this.resetStats();

    // 评估数据质量
    const dataQuality = this.assessDataQuality(patientData);

    logger.info({
      totalTrials: trials.length,
      config,
      dataQuality
    }, '[HybridMatching] 开始混合匹配流程');

    // Layer 1: 快速检索筛选候选
    const candidates = await this.layer1_retrieval(patientData, trials, config);

    // Layer 2: 规则引擎评分
    const scoredMatches = await this.layer2_ruleEngine(patientData, candidates, config);

    // Layer 3: LLM精确复核（可选）
    const finalMatches = config.llmReview.enabled
      ? await this.layer3_llmReview(patientData, scoredMatches, config)
      : scoredMatches;

    const duration = Date.now() - startTime;

    logger.info({
      ...this.stats,
      totalMatches: finalMatches.length,
      duration
    }, '[HybridMatching] 混合匹配完成');

    return {
      matches: finalMatches.map(match => ({
        ...match,
        dataQualityWarning: !dataQuality.isComplete,
        missingFields: dataQuality.missingFields
      })),
      metadata: {
        provider: 'hybrid',
        algorithmVersion: 'v2.0-hybrid',
        totalTrials: trials.length,
        layer1Candidates: candidates.length,
        layer2Scored: scoredMatches.length,
        llmReviewed: this.stats.llmCalled,
        cacheHits: this.stats.cacheHits,
        processingTime: duration,
        costEstimate: this.estimateCost(),
        dataQuality
      }
    };
  }

  /**
   * Layer 1: 快速检索 - Token匹配 + Stage匹配
   */
  async layer1_retrieval(patientData, trials, config) {
    const MIN_CANDIDATES = 30;
    const desiredLimit = Math.min(
      trials.length,
      Math.max(config.retrieval.candidateLimit, MIN_CANDIDATES)
    );

    const candidates = retrievalService.selectCandidates(
      patientData,
      trials,
      desiredLimit
    );

    this.stats.layer1Filtered = trials.length - candidates.length;

    logger.info({
      totalTrials: trials.length,
      candidates: candidates.length,
      filtered: this.stats.layer1Filtered
    }, '[HybridMatching] Layer 1: 快速检索完成');

    return candidates;
  }

  /**
   * Layer 2: 规则引擎评分
   */
  async layer2_ruleEngine(patientData, candidates, config) {
    const engine = new TrialMatchingEngine();
    await engine.ensureTrialsLoaded();

    const results = [];

    for (const trial of candidates) {
      try {
        const matchResult = await engine.evaluateTrialMatch(patientData, trial);

        if (matchResult && matchResult.matchScore >= config.ruleEngine.minScore) {
          results.push(matchResult);
        }
      } catch (error) {
        logger.warn({
          err: error,
          trialId: trial.项目编码 || trial.trialId
        }, '[HybridMatching] Layer 2评分失败');
      }
    }

    // 按分数降序排序，保留topK
    results.sort((a, b) => b.matchScore - a.matchScore);
    const topResults = results.slice(0, config.ruleEngine.topK);

    this.stats.layer2Filtered = candidates.length - topResults.length;

    logger.info({
      candidates: candidates.length,
      scored: topResults.length,
      avgScore: topResults.length > 0
        ? Math.round(topResults.reduce((sum, r) => sum + r.matchScore, 0) / topResults.length)
        : 0
    }, '[HybridMatching] Layer 2: 规则评分完成');

    return topResults;
  }

  /**
   * Layer 3: LLM精确复核
   */
  async layer3_llmReview(patientData, scoredMatches, config) {
    const llmConfig = config.llmReview;

    // 筛选需要LLM复核的候选
    const candidatesForLLM = scoredMatches
      .filter(match => match.matchScore >= llmConfig.minScoreForLLM)
      .slice(0, llmConfig.topK);

    if (candidatesForLLM.length === 0) {
      logger.info('[HybridMatching] 无需LLM复核，规则评分已足够');
      return scoredMatches;
    }

    const llmResults = [];

    for (const match of candidatesForLLM) {
      try {
        // 检查缓存
        const cacheKey = this.getCacheKey(patientData, match.trial_id);

        if (llmConfig.cacheEnabled) {
          const cached = await this.getFromCache(cacheKey);
          if (cached) {
            this.stats.cacheHits++;
            llmResults.push({ ...match, ...cached, fromCache: true });
            continue;
          }
        }

        // LLM复核
        const llmMatch = await this.reviewWithLLM(patientData, match);

        // 缓存结果
        if (llmConfig.cacheEnabled && llmMatch) {
          await this.saveToCache(cacheKey, llmMatch, llmConfig.cacheTTL);
        }

        this.stats.llmCalled++;
        llmResults.push(llmMatch);

      } catch (error) {
        logger.warn({
          err: error,
          trialId: match.trial_id
        }, '[HybridMatching] LLM复核失败，使用规则评分结果');
        llmResults.push(match);
      }
    }

    // 合并LLM结果和未复核的结果
    const remainingMatches = scoredMatches.slice(candidatesForLLM.length);
    const finalMatches = [...llmResults, ...remainingMatches];

    logger.info({
      candidatesForLLM: candidatesForLLM.length,
      llmCalled: this.stats.llmCalled,
      cacheHits: this.stats.cacheHits
    }, '[HybridMatching] Layer 3: LLM复核完成');

    return finalMatches;
  }

  /**
   * 使用LLM复核单个匹配结果
   * 注意：这里暂时返回规则评分结果，待集成实际LLM服务
   */
  async reviewWithLLM(patientData, ruleMatch) {
    // TODO: 集成实际LLM服务
    // 当前策略：规则评分权重40% + LLM评分权重60%

    // 暂时返回增强的规则评分结果
    return {
      ...ruleMatch,
      match_score: ruleMatch.matchScore,
      llm_reviewed: false,
      llm_note: 'LLM服务待集成',
      hybrid: true
    };
  }

  getCacheKey(patientData, trialId) {
    const patientHash = crypto
      .createHash('md5')
      .update(JSON.stringify(patientData))
      .digest('hex')
      .substring(0, 16);
    return `llm_match:${patientHash}:${trialId}`;
  }

  async getFromCache(key) {
    try {
      return await cacheService.get(key);
    } catch (error) {
      logger.warn({ err: error, key }, '[HybridMatching] 缓存读取失败');
      return null;
    }
  }

  async saveToCache(key, value, ttl) {
    try {
      await cacheService.set(key, value, ttl);
    } catch (error) {
      logger.warn({ err: error, key }, '[HybridMatching] 缓存写入失败');
    }
  }

  estimateCost() {
    const costPerLLMCall = 0.05; // ¥0.05/次
    return {
      llmCalls: this.stats.llmCalled,
      estimatedCost: (this.stats.llmCalled * costPerLLMCall).toFixed(2),
      savedCost: (this.stats.cacheHits * costPerLLMCall).toFixed(2)
    };
  }

  resetStats() {
    this.stats = {
      layer1Filtered: 0,
      layer2Filtered: 0,
      llmCalled: 0,
      cacheHits: 0
    };
  }

  /**
   * 评估患者数据质量 - 识别缺失的关键字段
   * Assess patient data quality - Identify missing critical fields
   */
  assessDataQuality(patientData) {
    const missingFields = [];
    const criticalFields = [
      { key: 'age', paths: ['age', 'basic_info.age'] },
      { key: 'gender', paths: ['gender', 'basic_info.gender'] },
      { key: 'staging_value', paths: ['staging_value', 'stage', 'current_status.stage'] },
      { key: 'ecog_score', paths: ['ecog_score', 'performance_status.ecog_score'] }
    ];

    criticalFields.forEach(field => {
      const hasValue = field.paths.some(path => {
        const value = path.split('.').reduce((obj, key) => obj?.[key], patientData);
        return value != null && value !== '';
      });

      if (!hasValue) {
        missingFields.push(field.key);
      }
    });

    return {
      missingFields,
      isComplete: missingFields.length === 0,
      completionRate: ((4 - missingFields.length) / 4 * 100).toFixed(0)
    };
  }
}

// 导出单例和类
module.exports = new HybridMatchingService();
module.exports.HybridMatchingService = HybridMatchingService;
