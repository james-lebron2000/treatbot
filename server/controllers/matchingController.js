const mongoose = require('mongoose');
const { z } = require('zod');

const { MedicalRecord } = require('../models');
const trialCache = require('../services/trialCache');
const cacheService = require('../services/cache');
const logger = require('../utils/logger');
const { HttpError, BadRequestError, NotFoundError } = require('../utils/httpError');

const { computeClassicMatches } = require('../utils/matching');
const { normaliseRecordForMatching } = require('../utils/patientDataNormalizer');
const { prefilterTrials } = require('../utils/trialPrefilter');
const { filterTrialsByStatus, filterTrialsByGeo } = require('../utils/trialFilters');
const { summarizeTrialRequirements, computePatientRequirementCoverage } = require('../utils/trialRequirementAnalyzer');
const { validateMatchResults } = require('../utils/matchResultValidator');
const { recordLLMMatchFallback, recordMatchBatchMetrics } = require('../monitoring/metrics');
const { computeStructuredDataQuality } = require('../utils/dataQuality');
const {
  archiveToLegacyStructuredData,
  createPatientArchive,
  mergeArchives
} = require('../utils/patientArchive');
const { isClinicalArchiveFormat, refreshPatientLatestData } = require('../utils/medicalHelpers');
const { normalizeMatchFilters, computeMatchFiltersHash } = require('../utils/matchFiltersHash');

const { defaultContainer } = require('../services/ServiceContainer');
const hybridMatchingService = require('../services/hybridMatchingService');
const TrialMatchingFacade = require('../services/matching/TrialMatchingFacade');
const {
  trialMatchingEngine,
  convertEngineMatchesToEnhanced,
  attachMetadataToMatches,
  mapClassicMatchesToEnhanced,
  saveMatchSnapshot,
  getTrialLookup,
  enhancedTrialMatcher
} = require('../services/matchEngineService');

const { matchRequestSchema, enhancedMatchRequestSchema, limitMatchResults } = require('./medicalSchemas');

const trialMatchService = defaultContainer.deps.trialMatchService;
const matchingFacade = new TrialMatchingFacade({
  hybridMatchingService,
  trialMatchingEngine,
  enhancedTrialMatcher,
  convertEngineMatchesToEnhanced,
  attachMetadataToMatches,
  getTrialLookup
});

async function matchClinicalTrials(req, res, next) {
  try {
    const { recordId, record, filters } = matchRequestSchema.parse(req.body);
    if (recordId && !mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }
    const normalizedFilters = normalizeMatchFilters(filters);
    const filtersHash = computeMatchFiltersHash(normalizedFilters);

    let medicalRecord = null;
    if (recordId) {
      medicalRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
      if (!medicalRecord && !record) {
        throw new NotFoundError('Medical record not found');
      }
    }

    let cacheKey = null;
    // Only cache for persisted, owned records; avoids cache poisoning/leaks for adhoc matching.
    if (recordId && medicalRecord) {
      cacheKey = `match:classic:${recordId}:${filtersHash}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.success(cached, { message: 'Matching completed (cached)' });
      }
    }

    const trials = await trialCache.loadNormalizedTrials();
    const statusFilter = filters?.statuses || null;
    const recruitingTrials = statusFilter
      ? filterTrialsByStatus(trials, statusFilter).trials
      : trials.filter((trial) => trial.status !== 'completed' && trial.status !== 'suspended');
    const fallbackStructured = record?.clinicalArchive
      ? archiveToLegacyStructuredData(record.clinicalArchive)
      : record;

    const targetRecord = medicalRecord || { structuredData: fallbackStructured };
    const normalizedRecord = normaliseRecordForMatching(targetRecord);
    const structuredForMatch = normalizedRecord?.legacy || targetRecord?.structuredData;
    const dataQuality = computeStructuredDataQuality(structuredForMatch || {});

    if (!structuredForMatch || Object.keys(structuredForMatch).length === 0) {
      throw new BadRequestError('Structured medical data unavailable for matching');
    }

    const { trials: candidateTrials, stats: prefilterStats, diseaseSignals } = prefilterTrials(
      recruitingTrials,
      normalizedRecord,
      { geo: filters?.geo || null }
    );
    const trialLookup = getTrialLookup(candidateTrials);

    const trialRequirements = summarizeTrialRequirements(candidateTrials);
    const requirementCoverage = computePatientRequirementCoverage(
      normalizedRecord,
      trialRequirements.topIntents.map((entry) => entry.intent)
    );

    const matches = computeClassicMatches(candidateTrials, normalizedRecord, { diseaseSignals });
    const enhancedMatches = attachMetadataToMatches(
      mapClassicMatchesToEnhanced(matches, trialLookup),
      trialLookup
    );
    const limitedMatches = limitMatchResults(enhancedMatches);
    logger.debug({ userId: req.userId, recordId: recordId || null, resultCount: enhancedMatches.length }, 'Classic trial matching completed');

    const payload = {
      matches: limitedMatches,
      provider: {
        name: 'classic-rule-engine',
        source: 'structured-json',
        matchFilters: normalizedFilters,
        matchFiltersHash: filtersHash,
        totalTrials: recruitingTrials.length,
        evaluatedTrials: prefilterStats.evaluatedTrials,
        matchedTrials: limitedMatches.length,
        matchedTrialsTotal: enhancedMatches.length,
        matchedAt: new Date().toISOString(),
        dataQuality,
        prefilter: {
          totalCandidates: prefilterStats.totalCandidates,
          afterDisease: prefilterStats.afterDisease,
          afterDemographics: prefilterStats.afterDemographics,
          afterLocation: prefilterStats.afterLocation,
          diseaseApplied: prefilterStats.diseaseApplied,
          demographicsApplied: prefilterStats.demographicsApplied,
          locationApplied: prefilterStats.locationApplied,
          geoReason: prefilterStats.geoReason,
          diseaseFallback: Boolean(prefilterStats.diseaseFallback),
          tumorType: diseaseSignals?.tumorType || null,
          diseaseSlug: diseaseSignals?.slug || null,
          diseaseTags: diseaseSignals?.diseaseTags || [],
          rawTerms: diseaseSignals?.rawTerms || []
        },
        trialRequirements,
        requirementCoverage,
        missingChecklist: {
          requiredFields: dataQuality.missingFields || [],
          trialIntents: requirementCoverage?.missingIntents || []
        }
      }
    };

    if (medicalRecord) {
      await saveMatchSnapshot(medicalRecord, limitedMatches, payload.provider, req.userId);
    }
    if (cacheKey) {
      await cacheService.set(cacheKey, payload, Number(process.env.MATCH_CACHE_TTL || 600));
    }

    return res.success(payload, { message: 'Matching completed' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function matchClinicalTrialsWithLLM(req, res, next) {
  try {
    const { recordId, record, filters } = matchRequestSchema.parse(req.body);
    if (recordId && !mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }
    const normalizedFilters = normalizeMatchFilters(filters);
    const filtersHash = computeMatchFiltersHash(normalizedFilters);

    let medicalRecord = null;
    if (recordId) {
      medicalRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    }

    const trials = await trialCache.loadNormalizedTrials();
    const statusFilter = filters?.statuses || null;
    const recruitingTrials = statusFilter
      ? filterTrialsByStatus(trials, statusFilter).trials
      : trials.filter((trial) => trial.status !== 'completed' && trial.status !== 'suspended');

    const fallbackStructured = record?.clinicalArchive
      ? archiveToLegacyStructuredData(record.clinicalArchive)
      : record;

    const targetRecord = medicalRecord || { structuredData: fallbackStructured };
    const normalizedRecord = normaliseRecordForMatching(targetRecord);

    if (!normalizedRecord?.legacy || Object.keys(normalizedRecord.legacy).length === 0) {
      throw new BadRequestError('Structured medical data unavailable for matching');
    }

    const structuredForMatch = normalizedRecord.legacy;
    const rawStructuredData = targetRecord.structuredData || structuredForMatch;
    const dataQuality = computeStructuredDataQuality(structuredForMatch || {});

    const { trials: candidateTrials, stats: prefilterStats, diseaseSignals } = prefilterTrials(
      recruitingTrials,
      normalizedRecord,
      { geo: filters?.geo || null }
    );
    const trialLookup = getTrialLookup(candidateTrials);

    const trialRequirements = summarizeTrialRequirements(candidateTrials);
    const requirementCoverage = computePatientRequirementCoverage(
      normalizedRecord,
      trialRequirements.topIntents.map((entry) => entry.intent)
    );

    const prefilterMetadata = {
      totalCandidates: prefilterStats.totalCandidates,
      afterDisease: prefilterStats.afterDisease,
      afterDemographics: prefilterStats.afterDemographics,
      afterLocation: prefilterStats.afterLocation,
      diseaseApplied: prefilterStats.diseaseApplied,
      demographicsApplied: prefilterStats.demographicsApplied,
      locationApplied: prefilterStats.locationApplied,
      geoReason: prefilterStats.geoReason,
      diseaseFallback: Boolean(prefilterStats.diseaseFallback),
      tumorType: diseaseSignals?.tumorType || null,
      diseaseSlug: diseaseSignals?.slug || null,
      diseaseTags: diseaseSignals?.diseaseTags || [],
      rawTerms: diseaseSignals?.rawTerms || []
    };

    const normalizedForMatch = structuredForMatch;
    const csvText = trialCache.buildTrialsCsv(candidateTrials);

    const deterministicMatches = await trialMatchingEngine.matchPatient(normalizedForMatch, medicalRecord?.patientId || recordId || 'adhoc');
    const deterministicEnhanced = attachMetadataToMatches(
      convertEngineMatchesToEnhanced(deterministicMatches, trialLookup),
      trialLookup
    );
    const deterministicLimited = limitMatchResults(deterministicEnhanced);
    const baselineSummary = {
      matchCount: deterministicMatches.length,
      topScore: deterministicMatches[0]?.matchScore || 0
    };

    if (baselineSummary.matchCount >= 3 && baselineSummary.topScore >= 75) {
      const provider = {
        provider: 'rule-engine-v1',
        source: 'structured-json',
        matchFilters: normalizedFilters,
        matchFiltersHash: filtersHash,
        totalTrials: recruitingTrials.length,
        evaluatedTrials: prefilterStats.evaluatedTrials,
        matchedTrials: deterministicLimited.length,
        matchedTrialsTotal: deterministicEnhanced.length,
        matchedAt: new Date().toISOString(),
        dataQuality,
        baseline: baselineSummary,
        prefilter: prefilterMetadata
      };
      provider.trialRequirements = trialRequirements;
      provider.requirementCoverage = requirementCoverage;
      provider.missingChecklist = {
        requiredFields: dataQuality.missingFields || [],
        trialIntents: requirementCoverage?.missingIntents || []
      };
      if (medicalRecord) {
        await saveMatchSnapshot(medicalRecord, deterministicLimited, provider, req.userId);
      }
      return res.success({ matches: deterministicLimited, provider }, { message: 'LLM 匹配已跳过：规则结果满足阈值' });
    }

    let cacheKey = null;
    // Only cache for persisted, owned records; avoids cache poisoning/leaks for adhoc matching.
    if (recordId && medicalRecord) {
      cacheKey = `match:llm:${recordId}:${filtersHash}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return res.success(cached, { message: 'LLM matching completed (cached)' });
      }
    }

    const result = await trialMatchService.matchWithLLM({
      patientData: rawStructuredData,
      csvText,
      patientId: medicalRecord?.patientId || medicalRecord?.userId || recordId || 'adhoc',
      baseline: baselineSummary
    });

    if (!result.success) {
      const enhancedFallback = deterministicEnhanced.length > 0
        ? deterministicEnhanced
        : attachMetadataToMatches(
            mapClassicMatchesToEnhanced(
              computeClassicMatches(candidateTrials, normalizedRecord, { diseaseSignals }),
              trialLookup
            ),
            trialLookup
          );
      const enhancedFallbackLimited = limitMatchResults(enhancedFallback);
      const fallbackProvider = {
        ...(result.metadata || {}),
        source: 'structured-json',
        matchFilters: normalizedFilters,
        matchFiltersHash: filtersHash,
        totalTrials: recruitingTrials.length,
        evaluatedTrials: prefilterStats.evaluatedTrials,
        matchedTrials: enhancedFallbackLimited.length,
        matchedTrialsTotal: enhancedFallback.length,
        matchedAt: new Date().toISOString(),
        dataQuality,
        prefilter: prefilterMetadata
      };
      fallbackProvider.trialRequirements = trialRequirements;
      fallbackProvider.requirementCoverage = requirementCoverage;
      fallbackProvider.missingChecklist = {
        requiredFields: dataQuality.missingFields || [],
        trialIntents: requirementCoverage?.missingIntents || []
      };
      if (medicalRecord) {
        await saveMatchSnapshot(medicalRecord, enhancedFallbackLimited, fallbackProvider, req.userId);
      }
      recordLLMMatchFallback(result.metadata?.error ? 'llm_error' : 'empty_response');
      logger.warn({ patientId: medicalRecord?.patientId || recordId || 'adhoc' }, 'LLM matching unavailable, falling back to classic');
      return res.success({
        matches: enhancedFallbackLimited,
        provider: fallbackProvider
      }, { message: 'LLM matching unavailable – fallback to classic matching', status: 206 });
    }

    let normalized = Array.isArray(result.matches) ? result.matches : [];
    try {
      normalized = validateMatchResults(normalized, 'llm-controller');
    } catch (validationError) {
      recordLLMMatchFallback('controller_validation');
      logger.error({ err: validationError, recordId: recordId || null }, 'LLM匹配结果在控制器验证失败，切换到经典匹配');
      const enhancedFallback = deterministicEnhanced.length > 0
        ? deterministicEnhanced
        : attachMetadataToMatches(
            mapClassicMatchesToEnhanced(
              computeClassicMatches(candidateTrials, normalizedRecord, { diseaseSignals }),
              trialLookup
            ),
            trialLookup
          );
      const enhancedFallbackLimited = limitMatchResults(enhancedFallback);
      const validationFallbackProvider = {
        ...result.metadata,
        source: 'structured-json',
        matchFilters: normalizedFilters,
        matchFiltersHash: filtersHash,
        totalTrials: recruitingTrials.length,
        evaluatedTrials: prefilterStats.evaluatedTrials,
        matchedTrials: enhancedFallbackLimited.length,
        matchedTrialsTotal: enhancedFallback.length,
        error: validationError.message,
        note: 'Validation failed in controller',
        matchedAt: new Date().toISOString(),
        dataQuality,
        prefilter: prefilterMetadata
      };
      validationFallbackProvider.trialRequirements = trialRequirements;
      validationFallbackProvider.requirementCoverage = requirementCoverage;
      validationFallbackProvider.missingChecklist = {
        requiredFields: dataQuality.missingFields || [],
        trialIntents: requirementCoverage?.missingIntents || []
      };
      if (medicalRecord) {
        await saveMatchSnapshot(medicalRecord, enhancedFallbackLimited, validationFallbackProvider, req.userId);
      }
      return res.success({
        matches: enhancedFallbackLimited,
        provider: validationFallbackProvider
      }, { message: 'LLM matching validation failed – fallback to classic matching', status: 206 });
    }

    normalized = attachMetadataToMatches(normalized, trialLookup);
    const normalizedLimited = limitMatchResults(normalized);
    logger.info({ recordId: recordId || null, matches: normalized.length }, 'LLM trial matching completed');

    const payload = {
      matches: normalizedLimited,
      provider: {
        ...result.metadata,
        source: 'structured-json',
        matchFilters: normalizedFilters,
        matchFiltersHash: filtersHash,
        totalTrials: recruitingTrials.length,
        evaluatedTrials: prefilterStats.evaluatedTrials,
        matchedTrials: normalizedLimited.length,
        matchedTrialsTotal: normalized.length,
        matchedAt: new Date().toISOString(),
        dataQuality,
        prefilter: prefilterMetadata,
        trialRequirements,
        requirementCoverage,
        missingChecklist: {
          requiredFields: dataQuality.missingFields || [],
          trialIntents: requirementCoverage?.missingIntents || []
        }
      }
    };

    if (medicalRecord) {
      await saveMatchSnapshot(medicalRecord, normalizedLimited, payload.provider, req.userId);
    }

    if (cacheKey) {
      await cacheService.set(cacheKey, payload, Number(process.env.MATCH_CACHE_TTL || 600));
    }

    return res.success(payload, { message: 'LLM matching completed' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function matchTrialsWithStructuredData(req, res) {
  const payload = enhancedMatchRequestSchema.parse(req.body || {});
  const {
    structuredData,
    patientId,
    jobId,
    useHybridMatching = true,
    filters
  } = payload;

  if (!structuredData) {
    throw new BadRequestError('结构化数据不能为空');
  }

  const isClinicalArchive = isClinicalArchiveFormat(structuredData);

  logger.info({
    userId: req.user.userId,
    patientId,
    jobId,
    archiveFormat: isClinicalArchive,
    useHybridMatching
  }, '开始增强版临床试验匹配');

  try {
    let matchingResults;
    let provider = 'rule-engine-v1';
    let metadata = {};

    const normalizedTrials = await trialCache.loadNormalizedTrials();
    const statusFilter = filters?.statuses || null;
    const statusFilteredTrials = statusFilter
      ? filterTrialsByStatus(normalizedTrials, statusFilter).trials
      : normalizedTrials.filter((trial) => trial.status !== 'completed' && trial.status !== 'suspended');

    const geoResult = filterTrialsByGeo(statusFilteredTrials, filters?.geo || null);
    const recruitingTrials = geoResult.trials;
    const strategy = useHybridMatching ? 'hybrid' : 'rule-based';
    const facadeResult = await matchingFacade.match({
      patientData: structuredData,
      trials: recruitingTrials,
      strategy,
      options: {
        patientId,
        hybridOptions: {
          llmReview: { enabled: false }
        }
      }
    });

    matchingResults = facadeResult.matches || [];
    provider = facadeResult.provider || provider;
    metadata = facadeResult.metadata || {};
    
    const topScore = matchingResults[0]?.matchScore ?? matchingResults[0]?.match_score ?? 0;
    const limitedResults = limitMatchResults(matchingResults);

    logger.info({
      userId: req.user.userId,
      patientId,
      matchedTrialsCount: matchingResults.length,
      topMatchScore: topScore
    }, '增强版临床试验匹配完成');

    if (patientId) {
      let targetRecord = null;

      if (mongoose.isValidObjectId(patientId)) {
        targetRecord = await MedicalRecord.findOne({ patientId, userId: req.userId }).sort({ uploadDate: -1 });
      }

      if (targetRecord) {
        const historyMetadata = {
          provider,
          source: 'structured-json',
          totalTrials: recruitingTrials.length,
          matchedTrials: limitedResults.length,
          matchedTrialsTotal: matchingResults.length,
          matchedAt: new Date().toISOString(),
          processingJobId: jobId || null
        };
        await saveMatchSnapshot(targetRecord, limitedResults, historyMetadata, req.userId);
      }
    }

    const engineStats = await trialMatchingEngine.getEngineStats();

    res.json({
      success: true,
      data: {
        matches: limitedResults,
        patientId,
        matchedAt: new Date().toISOString(),
        metadata: {
          totalMatches: limitedResults.length,
          totalMatchesTotal: matchingResults.length,
          engineStats,
          provider,
          totalTrials: recruitingTrials.length,
          ...(metadata.layer1Candidates !== undefined ? {
            hybridMetadata: metadata
          } : {}),
          dataQuality: metadata.dataQuality || {
            missingFields: [],
            isComplete: true,
            completionRate: '100'
          }
        }
      }
    });
  } catch (error) {
    logger.error({ err: error, userId: req.user.userId, patientId }, '增强版匹配失败');
    throw new HttpError(500, '临床试验匹配失败', error.message);
  }
}

async function matchAllClinicalTrials(req, res, next) {
  try {
    const {
      recordId,
      record,
      offset = 0,
      limit = null,
      batchSize = 50,
      minScore = 0,
      enableStreaming = false
    } = req.body || {};

    let medicalRecord = null;
    if (recordId) {
      if (!mongoose.isValidObjectId(recordId)) {
        throw new BadRequestError('Invalid medical record identifier');
      }
      medicalRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
      if (!medicalRecord && !record) {
        throw new NotFoundError('Medical record not found');
      }
    }

    const trials = await trialCache.loadNormalizedTrials();
    const recruitingTrials = trials.filter((trial) => trial.status !== 'completed' && trial.status !== 'suspended');

    const fallbackStructured = record?.clinicalArchive
      ? archiveToLegacyStructuredData(record.clinicalArchive)
      : record;

    const targetRecord = medicalRecord || { structuredData: fallbackStructured };
    const structuredForMatch = medicalRecord?.clinicalArchive
      ? archiveToLegacyStructuredData(medicalRecord.clinicalArchive)
      : targetRecord?.structuredData;

    if (!structuredForMatch || Object.keys(structuredForMatch).length === 0) {
      throw new BadRequestError('Structured medical data unavailable for matching');
    }

    logger.info({
      userId: req.userId,
      recordId: recordId || null,
      totalTrials: recruitingTrials.length,
      offset,
      limit,
      batchSize,
      enableStreaming
    }, '开始连续临床试验匹配');

    // eslint-disable-next-line global-require
    const TrialMatchingEngine = require('../services/trialMatchingEngine');
    const matchingEngine = new TrialMatchingEngine();
    await matchingEngine.ensureTrialsLoaded();

    let totalProcessed = 0;
    let totalMatches = 0;

    if (enableStreaming) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      res.write(JSON.stringify({ type: 'start', totalTrials: recruitingTrials.length }) + '\n');

      await matchingEngine.processAllTrialsInBatches(
        structuredForMatch,
        async (batchResults, batchInfo) => {
          totalProcessed += batchInfo.batchSize;
          totalMatches += batchResults.length;

          const batchData = {
            type: 'batch',
            matches: batchResults,
            batchIndex: batchInfo.batchIndex,
            totalProcessed: batchInfo.totalProcessed,
            remaining: batchInfo.remaining,
            matchCount: batchResults.length
          };

          res.write(JSON.stringify(batchData) + '\n');
        },
        {
          batchSize,
          minScore,
          maxBatches: limit ? Math.ceil(limit / batchSize) : null,
          delayBetweenBatches: 100
        }
      );

      res.write(JSON.stringify({
        type: 'complete',
        totalProcessed,
        totalMatches,
        totalTrials: recruitingTrials.length
      }) + '\n');

      res.end();
      return;
    }

    const actualLimit = limit || recruitingTrials.length;
    const paginatedResult = matchingEngine.selectCandidateTrialsPaginated(
      structuredForMatch,
      {
        offset,
        limit: actualLimit,
        batchSize,
        minScore
      }
    );

    const detailedMatches = [];
    for (const trial of paginatedResult.candidates) {
      try {
        const matchResult = await matchingEngine.evaluateTrialMatch(structuredForMatch, trial);
        if (matchResult) {
          detailedMatches.push(matchResult);
        }
      } catch (error) {
        logger.error({
          err: error,
          trialId: trial.项目编码,
          userId: req.userId
        }, '单个试验详细匹配评估失败');
      }
    }

    detailedMatches.sort((a, b) => b.matchScore - a.matchScore);

    logger.info({
      userId: req.userId,
      totalProcessed: paginatedResult.currentCount,
      totalMatches: detailedMatches.length,
      hasMore: paginatedResult.hasMore,
      nextOffset: paginatedResult.nextOffset
    }, '完成连续临床试验匹配');

    return res.success({
      matches: detailedMatches,
      pagination: {
        offset: paginatedResult.currentOffset,
        limit: actualLimit,
        total: paginatedResult.total,
        hasMore: paginatedResult.hasMore,
        nextOffset: paginatedResult.nextOffset,
        currentCount: paginatedResult.currentCount
      },
      provider: {
        name: 'enhanced-continuous-matcher',
        source: 'all-trials-database',
        totalTrials: recruitingTrials.length,
        processedTrials: paginatedResult.currentCount
      }
    }, { message: `Matched ${detailedMatches.length} trials from ${paginatedResult.currentCount} processed` });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  matchClinicalTrials,
  matchClinicalTrialsWithLLM,
  matchTrialsWithStructuredData,
  matchAllClinicalTrials
};
