const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { MatchJob, MedicalRecord } = require('../models');
const { executeBatchMatch, resolveStructuredDataForMatching } = require('./matchEngineService');
const { normalizeMatchFilters, computeMatchFiltersHash } = require('../utils/matchFiltersHash');

class JobRuntime {
  constructor(jobId, emitter, context) {
    this.jobId = jobId;
    this.emitter = emitter;
    this.context = context;
    this.status = 'running';
    this.cancelled = false;
  }
}

class MatchJobManager {
  constructor() {
    this.jobs = new Map(); // jobId -> JobRuntime
    this.recordJobMap = new Map(); // recordId -> { jobId, filtersHash }
  }

  getActiveRuntime(jobId) {
    return this.jobs.get(jobId) || null;
  }

  async startJob({ recordId, userId, batchSize, restart = false, filters = null }) {
    const normalizedFilters = normalizeMatchFilters(filters);
    const filtersHash = computeMatchFiltersHash(normalizedFilters);

    const existing = this.recordJobMap.get(String(recordId));
    if (existing?.jobId && !restart) {
      const existingDoc = await MatchJob.findOne({ jobId: existing.jobId });
      const existingHash = existingDoc?.filtersHash || existing.filtersHash || null;
      const existingStatus = existingDoc?.status || 'running';

      if (existingHash === filtersHash && existingStatus === 'running') {
        return { reused: true, jobId: existing.jobId, status: existingStatus, metadata: existingDoc?.metadata || null };
      }

      if (existingStatus === 'running') {
        // Filter changed while running: cancel runtime (if any) and start a new job.
        await this.cancelJob(existing.jobId, { reason: 'filters-changed' });
      } else {
        // Job already finished; just drop the active mapping and start a new one.
        this.recordJobMap.delete(String(recordId));
      }
    }

    if (existing?.jobId && restart) {
      const existingDoc = await MatchJob.findOne({ jobId: existing.jobId });
      const existingStatus = existingDoc?.status || 'running';
      if (existingStatus === 'running') {
        await this.cancelJob(existing.jobId, { reason: 'restart-requested' });
      } else {
        this.recordJobMap.delete(String(recordId));
      }
    }

    const record = await MedicalRecord.findOne({ _id: recordId, userId });
    if (!record) {
      throw new Error('Medical record not found');
    }

    const structuredData = resolveStructuredDataForMatching(record);
    if (!structuredData) {
      throw new Error('Structured medical data unavailable for matching');
    }

    // Avoid returning stale matches/metadata while a new job is starting.
    // Historical snapshots are preserved via matchHistory in saveMatchSnapshot.
    record.matchResults = [];
    record.matchMetadata = {
      provider: 'rule-engine-batch',
      source: 'structured-json',
      algorithmVersion: 'engine-batch-v1',
      matchedAt: new Date().toISOString(),
      hasMore: true,
      matchFilters: normalizedFilters
    };
    record.markModified('matchResults');
    record.markModified('matchMetadata');
    await record.save();

    const jobId = uuidv4();
    const emitter = new EventEmitter();

    const jobDoc = await MatchJob.create({
      jobId,
      recordId,
      userId,
      status: 'running',
      batchSize: batchSize || null,
      sessionId: recordId.toString(),
      filters: normalizedFilters,
      filtersHash
    });

    const runtime = new JobRuntime(jobId, emitter, {
      record,
      structuredData,
      userId,
      requestedBatchSize: batchSize,
      restart: true,
      filters: normalizedFilters
    });

    this.jobs.set(jobId, runtime);
    this.recordJobMap.set(String(recordId), { jobId, filtersHash });

    setImmediate(() => {
      this.processJob(jobId).catch((error) => {
        logger.error({ err: error, jobId }, 'Match job processing failed unexpectedly');
      });
    });

    return { reused: false, jobId, status: jobDoc.status };
  }

  async cancelJob(jobId, { reason = 'cancelled' } = {}) {
    const runtime = this.jobs.get(jobId);
    if (runtime) {
      runtime.cancelled = true;
      runtime.status = 'canceled';
      runtime.emitter.emit('cancelled', { jobId, reason });
      this.jobs.delete(jobId);
      if (runtime.context?.record?._id) {
        this.recordJobMap.delete(String(runtime.context.record._id));
      }
    }
    await MatchJob.findOneAndUpdate({ jobId }, { status: 'canceled', error: reason, updatedAt: new Date() });
  }

  async processJob(jobId) {
    const runtime = this.jobs.get(jobId);
    if (!runtime || runtime.cancelled) {
      return;
    }

    try {
      const { context } = runtime;
      const result = await executeBatchMatch({
        record: context.record,
        structuredData: context.structuredData,
        userId: context.userId,
        restart: context.restart,
        requestedBatchSize: context.restart ? context.requestedBatchSize : undefined,
        matchRunId: jobId,
        filters: context.filters
      });

      context.restart = false;

      await MatchJob.findOneAndUpdate({ jobId }, {
        status: result.batch.hasMore ? 'running' : 'completed',
        batchSize: result.batch.size,
        totalBatches: result.batch.total,
        processedBatches: result.batch.number,
        processedTrials: result.batch.processedTrials,
        remainingTrials: result.batch.remainingTrials,
        totalCandidates: result.batchResult?.totalCandidates ?? undefined,
        metadata: result.metadata,
        updatedAt: new Date()
      });

      runtime.emitter.emit('batch', {
        jobId,
        batch: result.batch,
        matches: result.matches,
        aggregatedMatches: result.aggregatedMatches,
        metadata: result.metadata
      });

      if (result.batch.hasMore && !runtime.cancelled) {
        context.record = await MedicalRecord.findOne({ _id: context.record._id, userId: context.userId });
        setTimeout(() => {
          this.processJob(jobId).catch((error) => {
            logger.error({ err: error, jobId }, 'Match job processing failed in continuation');
          });
        }, 50);
        return;
      }

      runtime.status = 'completed';
      this.jobs.delete(jobId);
      if (context.record?._id) {
        this.recordJobMap.delete(String(context.record._id));
      }
      runtime.emitter.emit('complete', {
        jobId,
        metadata: result.metadata,
        aggregatedMatches: result.aggregatedMatches
      });
    } catch (error) {
      logger.error({ err: error, jobId }, 'Match job execution error');
      runtime.status = 'failed';
      runtime.emitter.emit('error', {
        jobId,
        error: error.message || 'Unknown error'
      });
      await MatchJob.findOneAndUpdate({ jobId }, {
        status: 'failed',
        error: error.message,
        updatedAt: new Date()
      });
      this.jobs.delete(jobId);
      const recordId = runtime.context?.record?._id;
      if (recordId) {
        this.recordJobMap.delete(String(recordId));
      }
    }
  }

  getEmitter(jobId) {
    const runtime = this.jobs.get(jobId);
    if (runtime) {
      return runtime.emitter;
    }
    return null;
  }

  async getJobDocument(jobId, userId) {
    return MatchJob.findOne({ jobId, userId });
  }
}

module.exports = new MatchJobManager();
