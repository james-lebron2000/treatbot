const mongoose = require('mongoose');

const { MedicalRecord } = require('../models');
const { BadRequestError, NotFoundError } = require('../utils/httpError');
const { recordMatchBatchMetrics } = require('../monitoring/metrics');
const matchJobManager = require('../services/matchJobManager');

const {
  trialMatchingEngine,
  executeBatchMatch,
  resolveStructuredDataForMatching
} = require('../services/matchEngineService');
const { matchFiltersSchema } = require('./medicalSchemas');

async function startMatchJob(req, res, next) {
  const { recordId } = req.params;
  const { batchSize, restart = false, filters } = req.body || {};

  try {
    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const parsedFilters = matchFiltersSchema ? matchFiltersSchema.parse(filters ?? undefined) : undefined;

    const startResult = await matchJobManager.startJob({
      recordId,
      userId: req.userId,
      batchSize,
      restart,
      filters: parsedFilters
    });

    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    return res.success({
      jobId: startResult.jobId,
      status: startResult.status,
      reused: startResult.reused,
      matches: Array.isArray(record.matchResults) ? record.matchResults : [],
      metadata: record.matchMetadata || null
    }, { message: startResult.reused ? 'Streaming match job already running' : 'Streaming match job started' });
  } catch (error) {
    return next(error);
  }
}

async function streamMatchJob(req, res) {
  const { recordId } = req.params;
  const { jobId } = req.query || {};

  try {
    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }
    if (!jobId || typeof jobId !== 'string') {
      throw new BadRequestError('Missing match job identifier');
    }

    const jobDoc = await matchJobManager.getJobDocument(jobId, req.userId);
    if (!jobDoc || String(jobDoc.recordId) !== recordId) {
      throw new NotFoundError('Match job not found');
    }

    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) {
      res.flushHeaders();
    }
    req.socket.setTimeout(0);

    const writeEvent = (type, payload) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent('initial', {
      jobId,
      status: jobDoc.status,
      metadata: record.matchMetadata || null,
      matches: Array.isArray(record.matchResults) ? record.matchResults : []
    });

    const emitter = matchJobManager.getEmitter(jobId);

    if (!emitter) {
      writeEvent('complete', {
        jobId,
        metadata: record.matchMetadata || null,
        matches: Array.isArray(record.matchResults) ? record.matchResults : []
      });
      res.end();
      return;
    }

    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      emitter.off('batch', onBatch);
      emitter.off('complete', onComplete);
      emitter.off('error', onError);
      emitter.off('cancelled', onCancelled);
    };

    const onBatch = (payload) => writeEvent('batch', payload);
    const onComplete = (payload) => {
      writeEvent('complete', payload);
      cleanup();
      res.end();
    };
    const onError = (payload) => {
      writeEvent('error', payload);
      cleanup();
      res.end();
    };
    const onCancelled = (payload) => {
      writeEvent('cancelled', payload);
      cleanup();
      res.end();
    };

    emitter.on('batch', onBatch);
    emitter.on('complete', onComplete);
    emitter.on('error', onError);
    emitter.on('cancelled', onCancelled);

    req.on('close', cleanup);
    req.on('end', cleanup);
  } catch (error) {
    if (!res.headersSent) {
      res.status(error.status || 500).json({ message: error.message || 'Streaming match job failed' });
    } else {
      res.end();
    }
  }
}

async function processBatchMatch(req, res, next) {
  const { recordId } = req.params;
  const { restart = false, batchSize: requestedBatchSize, filters } = req.body || {};

  try {
    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const structuredData = resolveStructuredDataForMatching(record);
    if (!structuredData) {
      throw new BadRequestError('Structured medical data unavailable for matching');
    }

    const parsedFilters = matchFiltersSchema ? matchFiltersSchema.parse(filters ?? undefined) : undefined;

    const result = await executeBatchMatch({
      record,
      structuredData,
      userId: req.userId,
      restart,
      requestedBatchSize,
      filters: parsedFilters
    });

    recordMatchBatchMetrics({
      durationMs: result.batch.durationMs,
      batchSize: result.batch.size,
      status: 'success'
    });

    return res.success({
      batch: result.batch,
      matches: result.matches,
      aggregatedMatches: result.aggregatedMatches,
      metadata: result.metadata
    }, { message: `Batch ${result.batch.number} processed` });
  } catch (error) {
    return next(error);
  }
}

async function getBatchMatchStatus(req, res, next) {
  const { recordId } = req.params;

  try {
    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const metadata = record.matchMetadata || {};
    const matches = Array.isArray(record.matchResults) ? record.matchResults : [];
    const session = trialMatchingEngine.getBatchSession(recordId.toString());

    return res.success({
      metadata,
      matches,
      session: session ? {
        totalCandidates: session.totalCandidates,
        completed: session.lastOffset,
        batchSize: session.batchSize
      } : null
    }, { message: 'Batch status retrieved' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  startMatchJob,
  streamMatchJob,
  processBatchMatch,
  getBatchMatchStatus
};
