const TrialMatchingEngine = require('./trialMatchingEngine');
const enhancedTrialMatcher = require('./enhancedTrialMatcher');
const trialCache = require('./trialCache');
const logger = require('../utils/logger');
const { MedicalRecord, Patient } = require('../models');
const { validateMatchResults } = require('../utils/matchResultValidator');
const matchingRulesConfig = require('../config/matchingRules.json');
const { normaliseRecordForMatching } = require('../utils/patientDataNormalizer');
const { computeStructuredDataQuality } = require('../utils/dataQuality');
const { summarizeTrialRequirements, computePatientRequirementCoverage } = require('../utils/trialRequirementAnalyzer');
const { filterTrialsByStatus } = require('../utils/trialFilters');

function pruneMatchHistoryEntries(record, maxEntries) {
  const max = Number.isFinite(Number(maxEntries)) ? Math.max(1, Math.floor(Number(maxEntries))) : 50;
  if (!record?.matchHistory || !Array.isArray(record.matchHistory)) return;
  if (record.matchHistory.length <= max) return;

  const sortKey = (entry) => {
    const matchedAt = entry?.metadata?.matchedAt;
    const candidate = matchedAt || entry?.createdAt;
    const time = candidate ? new Date(candidate).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };

  record.matchHistory = record.matchHistory
    .slice()
    .sort((a, b) => sortKey(b) - sortKey(a))
    .slice(0, max);
}

const trialMatchingEngine = new TrialMatchingEngine();

function determineResultFromText(text) {
  if (!text) return '不确定';
  if (/(不符合|不足|未达|偏高|偏低|缺失|不满足)/.test(text)) {
    return '不满足';
  }
  if (/(可能|待补|待确认|尚不明确)/.test(text)) {
    return '不确定';
  }
  if (/(符合|满足|达标|正常|阳性|可控|稳定)/.test(text)) {
    return '满足';
  }
  return '不确定';
}

function convertEngineMatchesToEnhanced(engineMatches = [], trialLookup = new Map()) {
  return engineMatches.map((match) => {
    const metadataSource = trialLookup.get(match.trialId);
    const { rawSource, ...metadata } = metadataSource || {};
    const inclusionChecks = [];

    (match.detailedAnalysis || []).forEach((category) => {
      const categoryLabel = category.category || '综合评分';
      (category.details || []).forEach((detail) => {
        const criterion = `${categoryLabel}: ${detail}`;
        inclusionChecks.push({
          criterion,
          patient_value: detail,
          result: determineResultFromText(detail)
        });
      });
    });

    if (inclusionChecks.length === 0) {
      inclusionChecks.push({
        criterion: '综合匹配评估',
        patient_value: `${match.matchScore}%`,
        result: match.matchScore >= 60 ? '满足' : '不确定'
      });
    }

    const exclusionChecks = (match.matchingBarriers || []).map((barrier) => ({
      criterion: barrier.issue,
      patient_value: '',
      result: barrier.severity === 'High' ? '不满足' : '可能不满足'
    }));

    const summary = {
      inclusion_met: inclusionChecks
        .filter((item) => item.result === '满足')
        .map((item) => item.criterion),
      exclusion_triggered: exclusionChecks
        .filter((item) => item.result !== '满足')
        .map((item) => item.criterion),
      uncertain: inclusionChecks
        .filter((item) => item.result === '不确定')
        .map((item) => item.criterion)
    };

    return {
      trial_id: match.trialId,
      trial_title: match.trialName,
      match_score: match.matchScore,
      inclusion_checks: inclusionChecks,
      exclusion_checks: exclusionChecks,
      summary,
      rank_reason: match.summary,
      trial_metadata: metadataSource ? { ...metadata, trialId: metadataSource.trialId } : match.trialInfo
    };
  });
}

function mergeEnhancedMatches(existing = [], updates = []) {
  const merged = new Map();
  (existing || []).forEach((match) => {
    if (match && match.trial_id) {
      merged.set(match.trial_id, match);
    }
  });
  (updates || []).forEach((match) => {
    if (match && match.trial_id) {
      merged.set(match.trial_id, match);
    }
  });
  return Array.from(merged.values()).sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
}

function resolveStructuredDataForMatching(record) {
  if (!record) {
    return null;
  }
  const normalized = normaliseRecordForMatching(record);
  if (!normalized) {
    return null;
  }
  return normalized.legacy;
}

function buildBatchMetadata(previous = {}, {
  batchResult,
  batchSize,
  aggregatedCount,
  durationMs,
  dataQuality,
  trialRequirements,
  requirementCoverage,
  matchRunId,
  matchFilters
}) {
  const nowIso = new Date().toISOString();
  const totalTrials = batchResult?.totalCandidates ?? previous?.totalTrials ?? 0;
  const limit = batchResult?.limit || batchSize || previous?.batchSize || 0;
  const totalBatches = batchResult?.totalBatches || previous?.totalBatches || (limit > 0 ? Math.ceil(totalTrials / limit) : 1);
  const processedTrials = batchResult?.processedCount ?? previous?.processedTrials ?? 0;
  const remainingTrials = batchResult?.remainingCandidates ?? Math.max(0, totalTrials - processedTrials);
  const completedBatches = Math.min(totalBatches, batchResult?.batchNumber || Math.ceil(processedTrials / (limit || 1)));
  const timeline = Array.isArray(previous?.batchTimeline) ? previous.batchTimeline.slice() : [];
  timeline.push({
    batchNumber: batchResult?.batchNumber || completedBatches,
    processedTrials: batchResult?.results?.length || 0,
    durationMs: Math.max(0, durationMs || 0),
    completedAt: nowIso
  });

  return {
    ...previous,
    provider: 'rule-engine-batch',
    source: 'structured-json',
    algorithmVersion: 'engine-batch-v1',
    matchRunId: matchRunId || previous?.matchRunId,
    matchFilters: matchFilters || previous?.matchFilters || null,
    dataQuality: dataQuality || previous?.dataQuality,
    trialRequirements: trialRequirements || previous?.trialRequirements,
    requirementCoverage: requirementCoverage || previous?.requirementCoverage,
    missingChecklist: {
      requiredFields: (dataQuality?.missingFields || previous?.dataQuality?.missingFields || []),
      trialIntents: (requirementCoverage?.missingIntents || previous?.requirementCoverage?.missingIntents || [])
    },
    totalTrials,
    matchedTrials: aggregatedCount,
    batchSize: limit,
    totalBatches,
    completedBatches,
    processedTrials,
    remainingTrials,
    lastBatchNumber: batchResult?.batchNumber || completedBatches,
    lastBatchCompletedAt: nowIso,
    hasMore: Boolean(batchResult?.hasMore),
    batchTimeline: timeline,
    matchedAt: !batchResult?.hasMore ? nowIso : (previous?.matchedAt || nowIso)
  };
}

function getTrialLookup(trials = []) {
  return new Map(trials.map((trial) => [trial.trialId, trial]));
}

function attachMetadataToMatches(matches = [], trialLookup = new Map()) {
  return matches.map((match) => {
    if (match.trial_metadata) {
      return match;
    }
    const metadataSource = trialLookup.get(match.trial_id);
    if (!metadataSource) {
      return match;
    }
    const { rawSource, ...metadata } = metadataSource;
    return {
      ...match,
      trial_metadata: { ...metadata, trialId: metadataSource.trialId }
    };
  });
}

function summarizeEligibilityHits(matches = []) {
  return matches.reduce((acc, match) => {
    (match.inclusion_checks || []).forEach((check) => {
      if (!check || !check.result) return;
      if (check.result === '满足') {
        acc.inclusionMet += 1;
      } else if (check.result === '不满足' || check.result === '可能不满足') {
        acc.exclusionTriggered += 1;
      } else {
        acc.uncertain += 1;
      }
    });
    (match.exclusion_checks || []).forEach((check) => {
      if (!check || !check.result) return;
      if (check.result === '满足') {
        acc.exclusionCleared += 1;
      } else if (check.result === '不满足' || check.result === '可能不满足') {
        acc.exclusionTriggered += 1;
      } else {
        acc.uncertain += 1;
      }
    });
    return acc;
  }, {
    inclusionMet: 0,
    exclusionCleared: 0,
    exclusionTriggered: 0,
    uncertain: 0
  });
}

async function refreshPatientLatestData(patientId, userId) {
  if (!patientId) return;

  try {
    const latestRecord = await MedicalRecord.findOne({ userId, patientId }).sort({ uploadDate: -1 });
    await Patient.findOneAndUpdate({ _id: patientId, userId }, {
      latestRecordId: latestRecord?._id || null,
      latestStructuredData: latestRecord?.structuredData || null,
      latestClinicalArchive: latestRecord?.clinicalArchive || null,
      $currentDate: { updatedAt: true }
    });
  } catch (err) {
    logger.warn({ err, patientId }, 'Failed to refresh patient latest record data');
  }
}

async function saveMatchSnapshot(record, matches, metadata, userId) {
  if (!record) return;

  const clonedMatches = JSON.parse(JSON.stringify(matches || []));
  const snapshotMetadata = {
    ...(metadata || {}),
    matchedAt: metadata?.matchedAt || new Date().toISOString()
  };

  const ruleVersion = matchingRulesConfig.version || 'unknown';
  if (!snapshotMetadata.ruleVersion) {
    snapshotMetadata.ruleVersion = ruleVersion;
  }

  if (!snapshotMetadata.eligibilitySummary) {
    snapshotMetadata.eligibilitySummary = summarizeEligibilityHits(clonedMatches);
  }

  const runId = snapshotMetadata?.matchRunId;
  record.matchHistory = record.matchHistory || [];

  if (runId) {
    const existingEntry = record.matchHistory.find((entry) => entry?.metadata?.matchRunId === runId);
    if (existingEntry) {
      existingEntry.matches = clonedMatches;
      existingEntry.metadata = snapshotMetadata;
    } else {
      record.matchHistory.push({
        matches: clonedMatches,
        metadata: snapshotMetadata,
        createdAt: new Date()
      });
    }
  } else {
    record.matchHistory.push({
      matches: clonedMatches,
      metadata: snapshotMetadata,
      createdAt: new Date()
    });
  }

  record.matchResults = clonedMatches;
  record.matchMetadata = snapshotMetadata;
  pruneMatchHistoryEntries(record, Number(process.env.MATCH_HISTORY_MAX || 50));
  record.markModified('matchHistory');
  record.markModified('matchResults');
  record.markModified('matchMetadata');
  await record.save();

  if (record.patientId && userId) {
    await refreshPatientLatestData(record.patientId, userId);
  }
}

function mapClassicMatchesToEnhanced(matches = [], trialLookup = new Map()) {
  const enhanced = matches.map((match) => {
    const nestedTrial = match.trial || {};
    const trialIdRaw = match.trial_id || match.trialId || match.id || nestedTrial.trialId || nestedTrial.id || nestedTrial._id;
    const trialId = trialIdRaw ? String(trialIdRaw) : 'unknown-trial';
    const metadataSource = trialLookup.get(trialId);
    const rankReason = (() => {
      const candidates = [
        match.rank_reason,
        match.rankReason,
        match.reason
      ];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
      return '';
    })();

    const inclusionChecks = (match.inclusion_checks || match.inclusionChecks || []).map((check) => ({
      criterion: check.criterion || check.criteria || check.requirement || '未提供',
      patient_value: check.patient_value || check.patientValue || check.value || '未提供',
      result: check.result || check.status || '不确定'
    }));
    const exclusionChecks = (match.exclusion_checks || match.exclusionChecks || []).map((check) => ({
      criterion: check.criterion || check.criteria || check.requirement || '未提供',
      patient_value: check.patient_value || check.patientValue || check.value || '未提供',
      result: check.result || check.status || '不确定'
    }));
    const summary = match.summary || {
      inclusion_met: inclusionChecks
        .filter((item) => item.result === '满足')
        .map((item) => item.criterion),
      exclusion_triggered: exclusionChecks
        .filter((item) => item.result === '不满足' || item.result === '可能不满足')
        .map((item) => item.criterion),
      uncertain: inclusionChecks
        .filter((item) => item.result === '不确定')
        .map((item) => item.criterion)
    };

    const metadata = metadataSource ? { ...metadataSource } : {};
    const { rawSource, ...trialMetadata } = metadata;

    const rawScore = match.match_score ?? match.matchScore ?? match.score ?? match.match_score_raw;
    const matchScore = Number.isFinite(Number(rawScore))
      ? Math.max(0, Math.min(100, Math.round(Number(rawScore))))
      : 0;

    return {
      trial_id: trialId,
      trial_title: match.trial_title || match.title || match.trialName || nestedTrial.title || trialId || 'unknown-trial',
      match_score: matchScore,
      inclusion_checks: inclusionChecks,
      exclusion_checks: exclusionChecks,
      summary,
      rank_reason: rankReason || undefined,
      trial_metadata: trialMetadata ? { ...trialMetadata, trialId: metadataSource?.trialId } : undefined
    };
  });

  try {
    return validateMatchResults(enhanced, 'classic-fallback');
  } catch (error) {
    logger.error({ err: error }, 'Classic matcher results failed validation');
    return [];
  }
}

async function executeBatchMatch({ record, structuredData, userId, restart = false, requestedBatchSize, matchRunId = null, filters = null }) {
  if (!record) {
    throw new Error('Medical record is required for batch match execution');
  }

  const normalizedTrials = await trialCache.loadNormalizedTrials();
  const statusFilter = filters?.statuses || null;
  const statusFilteredTrials = statusFilter
    ? filterTrialsByStatus(normalizedTrials, statusFilter).trials
    : normalizedTrials;
  const trialLookup = getTrialLookup(statusFilteredTrials);
  const normalizedRecord = normaliseRecordForMatching(record);
  const dataQuality = computeStructuredDataQuality(structuredData || {});
  const trialRequirements = summarizeTrialRequirements(statusFilteredTrials);
  const requirementCoverage = computePatientRequirementCoverage(
    normalizedRecord,
    trialRequirements.topIntents.map((entry) => entry.intent)
  );

  const sessionId = record._id.toString();
  let session = trialMatchingEngine.getBatchSession(sessionId);
  if (!session || restart) {
    session = await trialMatchingEngine.createBatchSession(
      structuredData,
      record.patientId?.toString() || sessionId,
      sessionId,
      statusFilter
        ? { allowedTrialIds: statusFilteredTrials.map((t) => t.trialId).filter(Boolean) }
        : undefined
    );
  }

  const totalCandidates = session.totalCandidates || 0;
  const effectiveBatchSize = (() => {
    if (requestedBatchSize && requestedBatchSize > 0) {
      return requestedBatchSize;
    }
    if (!restart && record.matchMetadata?.batchSize) {
      return record.matchMetadata.batchSize;
    }
    return totalCandidates > 200 ? 20 : 10;
  })();

  const processedTrials = restart ? 0 : Number(record.matchMetadata?.processedTrials || 0);
  const offset = Math.min(processedTrials, totalCandidates);

  const startedAt = Date.now();
  const batchResult = await trialMatchingEngine.matchPatient(structuredData, record.patientId?.toString() || sessionId, {
    sessionId,
    offset,
    limit: effectiveBatchSize,
    initialize: restart
  });
  const durationMs = Date.now() - startedAt;

  const enhancedMatches = attachMetadataToMatches(
    convertEngineMatchesToEnhanced(batchResult.results || [], trialLookup),
    trialLookup
  );

  const baseMatches = restart ? [] : (Array.isArray(record.matchResults) ? record.matchResults : []);
  const aggregatedMatches = mergeEnhancedMatches(baseMatches, enhancedMatches);

  const metadata = buildBatchMetadata(restart ? {} : (record.matchMetadata || {}), {
    batchResult,
    batchSize: effectiveBatchSize,
    aggregatedCount: aggregatedMatches.length,
    durationMs,
    dataQuality,
    trialRequirements,
    requirementCoverage,
    matchRunId: matchRunId || undefined,
    matchFilters: filters || null
  });

  await saveMatchSnapshot(record, aggregatedMatches, metadata, userId);

  if (!batchResult.hasMore) {
    trialMatchingEngine.clearBatchSession(sessionId);
  }

  return {
    batch: {
      number: metadata.lastBatchNumber,
      total: metadata.totalBatches,
      size: metadata.batchSize,
      processedTrials: metadata.processedTrials,
      remainingTrials: metadata.remainingTrials,
      durationMs,
      hasMore: metadata.hasMore
    },
    matches: enhancedMatches,
    aggregatedMatches,
    metadata,
    batchResult
  };
}

module.exports = {
  trialMatchingEngine,
  executeBatchMatch,
  convertEngineMatchesToEnhanced,
  mergeEnhancedMatches,
  resolveStructuredDataForMatching,
  buildBatchMetadata,
  attachMetadataToMatches,
  mapClassicMatchesToEnhanced,
  saveMatchSnapshot,
  getTrialLookup,
  enhancedTrialMatcher
};
