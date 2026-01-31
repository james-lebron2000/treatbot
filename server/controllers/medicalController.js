/*
 * =====================================================
 * Medical Controller (Orchestrator)
 * =====================================================
 * This file intentionally remains small. It re-exports
 * focused controllers to keep route contracts stable.
 * =====================================================
 */

const ocrController = require('./ocrController');
const parsingController = require('./parsingController');
const matchingController = require('./matchingController');
const recordCRUDController = require('./recordCRUDController');
const stepwiseExtractionController = require('./stepwiseExtractionController');
const batchMatchingController = require('./batchMatchingController');
const matchHistoryController = require('./matchHistoryController');

// Backwards compatibility for older imports/tests
const { mapClassicMatchesToEnhanced } = require('../services/matchEngineService');

module.exports = {
  ...ocrController,
  ...parsingController,
  ...matchingController,
  ...recordCRUDController,
  ...stepwiseExtractionController,
  ...batchMatchingController,
  ...matchHistoryController,
  mapClassicMatchesToEnhanced
};

