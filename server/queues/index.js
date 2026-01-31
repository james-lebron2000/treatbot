const { Queue, Worker, QueueEvents } = require('bullmq');
const { getRedisClient, isRedisEnabled } = require('../config/redis');
const logger = require('../utils/logger');

const registry = new Map();

function isQueueEnabled() {
  const client = getRedisClient();
  return Boolean(client && isRedisEnabled());
}

function registerQueue(name, processor, options = {}) {
  const enabled = isQueueEnabled();
  const defaultAttempts = Number(options.attempts || process.env.STEPWISE_MAX_ATTEMPTS || 3);
  const defaultBackoff = options.backoff || {
    type: 'exponential',
    delay: Number(process.env.STEPWISE_BACKOFF_MS || 5000)
  };
  const concurrency = Number(options.concurrency || process.env.STEPWISE_CONCURRENCY || 2);

  if (!enabled) {
    logger.warn({ queue: name }, 'Queue disabled – executing processor inline');
    return {
      isMock: true,
      async add(_jobName, data) {
        await processor({ id: `${name}-mock-${Date.now()}`, name: _jobName, data });
        return null;
      },
      async addAndWait(_jobName, data) {
        return processor({ id: `${name}-mock-${Date.now()}`, name: _jobName, data });
      },
      async close() {
        return Promise.resolve();
      }
    };
  }

  if (!registry.has(name)) {
    const baseClient = getRedisClient();
    const queueConnection = baseClient.duplicate();
    const workerConnection = baseClient.duplicate();
    const eventsConnection = baseClient.duplicate();
    const queue = new Queue(name, { connection: queueConnection });
    const queueEvents = new QueueEvents(name, { connection: eventsConnection });
    queueEvents.on('error', (err) => {
      logger.error({ queue: name, err }, 'Queue events error');
    });
    const worker = new Worker(
      name,
      async (job) => {
        try {
          return await processor(job);
        } catch (err) {
          logger.error({ queue: name, jobId: job.id, err }, 'Queue job execution failed');
          throw err;
        }
      },
      {
        connection: workerConnection,
        concurrency
      }
    );

    worker.on('failed', (job, err) => {
      logger.error({ queue: name, jobId: job?.id, err }, 'Queue job failed');
    });

    worker.on('completed', (job) => {
      logger.debug({ queue: name, jobId: job.id }, 'Queue job completed');
    });

    registry.set(name, {
      queue,
      worker,
      queueConnection,
      workerConnection,
      queueEvents,
      eventsConnection,
      defaultAttempts,
      defaultBackoff
    });
  }

  const {
    queue,
    queueEvents,
    defaultAttempts: attempts,
    defaultBackoff: backoff
  } = registry.get(name);

  return {
    isMock: false,
    add(jobName, data, opts = {}) {
      return queue.add(jobName, data, {
        removeOnComplete: true,
        removeOnFail: false,
        attempts,
        backoff,
        ...opts
      });
    },
    async addAndWait(jobName, data, opts = {}) {
      const job = await queue.add(jobName, data, {
        removeOnComplete: true,
        removeOnFail: false,
        attempts,
        backoff,
        ...opts
      });
      return job.waitUntilFinished(queueEvents, opts.timeout);
    },
    async close() {
      await Promise.all([
        queue.close(),
        registry.get(name).worker.close(),
        registry.get(name).queueConnection.quit(),
        registry.get(name).workerConnection.quit(),
        registry.get(name).queueEvents.close(),
        registry.get(name).eventsConnection.quit()
      ]);
      registry.delete(name);
    }
  };
}

module.exports = {
  registerQueue
};
