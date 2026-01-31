const client = require('prom-client');
const logger = require('../utils/logger');

let initialized = false;
const register = client.register;

function initMetrics() {
  if (initialized) return;
  client.collectDefaultMetrics({
    register,
    prefix: 'clinicalmatch_'
  });
  initialized = true;
  logger.info('Prometheus metrics initialized');
}

const httpDuration = new client.Histogram({
  name: 'clinicalmatch_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code']
});

const llmMatchRequests = new client.Counter({
  name: 'clinicalmatch_llm_match_requests_total',
  help: 'LLM trial matching requests by status',
  labelNames: ['status']
});

const llmMatchTokens = new client.Counter({
  name: 'clinicalmatch_llm_match_tokens_total',
  help: 'Total tokens consumed by LLM trial matching',
  labelNames: ['token_type']
});

const llmMatchParseFailures = new client.Counter({
  name: 'clinicalmatch_llm_match_parse_failures_total',
  help: 'LLM trial matching parse/validation failures',
  labelNames: ['type']
});

const llmMatchFallbacks = new client.Counter({
  name: 'clinicalmatch_llm_match_fallback_total',
  help: 'Fallback activations for LLM trial matching',
  labelNames: ['reason']
});

const eligibilitySourceCounter = new client.Counter({
  name: 'clinicalmatch_trial_eligibility_source_total',
  help: 'Counts how eligibility data is sourced for matching',
  labelNames: ['type', 'source']
});

const trialSyncDuration = new client.Histogram({
  name: 'clinicalmatch_trial_sync_duration_seconds',
  help: 'Duration of trial eligibility synchronization in seconds',
  labelNames: ['status']
});

const trialSyncCriteria = new client.Counter({
  name: 'clinicalmatch_trial_sync_criteria_total',
  help: 'Total number of eligibility criteria parsed during synchronization',
  labelNames: ['type']
});

function metricsMiddleware(req, res, next) {
  initMetrics();
  const end = httpDuration.startTimer({ method: req.method, route: req.route?.path || req.path });
  res.on('finish', () => {
    try {
      end({ status_code: res.statusCode });
    } catch (err) {
      logger.warn({ err }, 'Failed to record HTTP duration metric');
    }
  });
  next();
}

async function metricsHandler(_req, res) {
  initMetrics();
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
}

function recordLLMMatchRequest(status = 'unknown') {
  initMetrics();
  try {
    llmMatchRequests.inc({ status });
  } catch (err) {
    logger.warn({ err, status }, 'Failed to record LLM match request metric');
  }
}

function recordLLMMatchTokens(tokenType = 'total', value = 0) {
  if (!value || Number.isNaN(value)) return;
  initMetrics();
  try {
    llmMatchTokens.inc({ token_type: tokenType }, value);
  } catch (err) {
    logger.warn({ err, tokenType, value }, 'Failed to record LLM token metric');
  }
}

function recordLLMMatchParseFailure(type = 'unknown') {
  initMetrics();
  try {
    llmMatchParseFailures.inc({ type });
  } catch (err) {
    logger.warn({ err, type }, 'Failed to record LLM parse failure metric');
  }
}

function recordLLMMatchFallback(reason = 'unknown') {
  initMetrics();
  try {
    llmMatchFallbacks.inc({ reason });
  } catch (err) {
    logger.warn({ err, reason }, 'Failed to record LLM fallback metric');
  }
}

function recordEligibilitySource(type = 'inclusion', source = 'unknown') {
  initMetrics();
  try {
    eligibilitySourceCounter.inc({ type, source });
  } catch (err) {
    logger.warn({ err, type, source }, 'Failed to record eligibility source metric');
  }
}

function recordTrialSyncMetrics({ status = 'success', durationMs = 0, inclusionCount = 0, exclusionCount = 0 } = {}) {
  initMetrics();
  try {
    const seconds = Math.max(0, Number(durationMs || 0)) / 1000;
    trialSyncDuration.observe({ status }, seconds);
  } catch (err) {
    logger.warn({ err, status, durationMs }, 'Failed to record trial sync duration');
  }

  try {
    if (inclusionCount) {
      trialSyncCriteria.inc({ type: 'inclusion' }, inclusionCount);
    }
    if (exclusionCount) {
      trialSyncCriteria.inc({ type: 'exclusion' }, exclusionCount);
    }
  } catch (err) {
    logger.warn({ err, inclusionCount, exclusionCount }, 'Failed to record trial sync criteria count');
  }
}

function recordMatchBatchMetrics({ status = 'success', durationMs = 0, batchSize = 0 } = {}) {
  initMetrics();
  try {
    const normalizedStatus = status || 'unknown';
    const seconds = Math.max(0, Number(durationMs || 0)) / 1000;
    // lazily create histogram and counter on first use to avoid breaking existing dashboards
    if (!recordMatchBatchMetrics._histogram) {
      recordMatchBatchMetrics._histogram = new client.Histogram({
        name: 'clinicalmatch_match_batch_duration_seconds',
        help: 'Duration of clinical trial batch matching operations in seconds',
        labelNames: ['status']
      });
      recordMatchBatchMetrics._counter = new client.Counter({
        name: 'clinicalmatch_match_batch_total',
        help: 'Count of clinical trial batch matching operations',
        labelNames: ['status']
      });
    }
    recordMatchBatchMetrics._histogram.observe({ status: normalizedStatus }, seconds);
    recordMatchBatchMetrics._counter.inc({ status: normalizedStatus });
    if (batchSize && !Number.isNaN(batchSize)) {
      if (!recordMatchBatchMetrics._batchGauge) {
        recordMatchBatchMetrics._batchGauge = new client.Gauge({
          name: 'clinicalmatch_match_batch_size',
          help: 'Number of trials processed in each batch',
          labelNames: ['status']
        });
      }
      recordMatchBatchMetrics._batchGauge.set({ status: normalizedStatus }, Number(batchSize));
    }
  } catch (err) {
    logger.warn({ err, status, durationMs, batchSize }, 'Failed to record match batch metric');
  }
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
  register,
  recordLLMMatchRequest,
  recordLLMMatchTokens,
  recordLLMMatchParseFailure,
  recordLLMMatchFallback,
  recordEligibilitySource,
  recordTrialSyncMetrics,
  recordMatchBatchMetrics
};
