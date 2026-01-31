#!/usr/bin/env node
/* eslint-disable no-console */
require('../config');
const logger = require('../utils/logger');
const StepwiseLLMService = require('../services/stepwiseLLMService');
const AlibabaOCRService = require('../services/ocrService');

(async () => {
  try {
    logger.info('Worker starting – initializing queues');
    const stepwiseService = new StepwiseLLMService();
    const ocrService = new AlibabaOCRService();

    logger.info('Queues initialized. Worker is listening for jobs.');

    process.on('SIGINT', async () => {
      logger.info('Worker received SIGINT, shutting down...');
      if (stepwiseService.queue && stepwiseService.queue.close) {
        await stepwiseService.queue.close();
      }
      if (ocrService.queue && ocrService.queue.close) {
        await ocrService.queue.close();
      }
      process.exit(0);
    });
  } catch (err) {
    logger.error({ err }, 'Worker failed to start');
    process.exit(1);
  }
})();
