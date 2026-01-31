/**
 * Service Container - Dependency Injection Container
 * Manages service instantiation and dependency wiring
 */

const AlibabaOCRService = require('./ocrService');
const LLMIntegrationService = require('./llmIntegrationService');
const StepwiseLLMService = require('./stepwiseLLMService');
const TrialMatchingService = require('./trialMatchingService');
const trialMatchingEngine = require('./trialMatchingEngine');
const hybridMatchingService = require('./hybridMatchingService');
const enhancedTrialMatcher = require('./enhancedTrialMatcher');
const matchJobManager = require('./matchJobManager');
const trialCache = require('./trialCache');
const cacheService = require('./cache');
const { MedicalRecord, Patient } = require('../models');

// Import new services (to be implemented)
const RecordProcessingService = require('./recordProcessing/RecordProcessingService');
// TODO: Uncomment when these services are implemented
// const RecordCRUDService = require('./recordCRUD/RecordCRUDService');
// const TrialMatchOrchestrator = require('./matching/TrialMatchOrchestrator');
// const BatchMatchCoordinator = require('./matching/BatchMatchCoordinator');
// const MatchHistoryService = require('./matching/MatchHistoryService');

/**
 * ServiceContainer class for managing service dependencies
 */
class ServiceContainer {
  constructor(dependencies = {}) {
    // Allow dependency injection for testing
    this.deps = {
      // External services
      ocrService: dependencies.ocrService || new AlibabaOCRService(),
      llmService: dependencies.llmService || new LLMIntegrationService(),
      stepwiseLLMService: dependencies.stepwiseLLMService || new StepwiseLLMService(),
      trialMatchService: dependencies.trialMatchService || new TrialMatchingService(),
      
      // Matching engines
      trialMatchingEngine: dependencies.trialMatchingEngine || trialMatchingEngine,
      hybridMatchingService: dependencies.hybridMatchingService || hybridMatchingService,
      enhancedTrialMatcher: dependencies.enhancedTrialMatcher || enhancedTrialMatcher,
      
      // Infrastructure
      matchJobManager: dependencies.matchJobManager || matchJobManager,
      trialCache: dependencies.trialCache || trialCache,
      cacheService: dependencies.cacheService || cacheService,
      
      // Models
      MedicalRecord: dependencies.MedicalRecord || MedicalRecord,
      Patient: dependencies.Patient || Patient
    };

    // Lazy-loaded service instances
    this._recordProcessingService = null;
    this._recordCRUDService = null;
    this._trialMatchOrchestrator = null;
    this._batchMatchCoordinator = null;
    this._matchHistoryService = null;
  }

  /**
   * Get RecordProcessingService instance (singleton)
   */
  getRecordProcessingService() {
    if (!this._recordProcessingService) {
      this._recordProcessingService = new RecordProcessingService({
        ocrService: this.deps.ocrService,
        llmService: this.deps.llmService,
        stepwiseLLMService: this.deps.stepwiseLLMService,
        MedicalRecord: this.deps.MedicalRecord,
        Patient: this.deps.Patient,
        cacheService: this.deps.cacheService
      });
    }
    return this._recordProcessingService;
  }

  /**
   * Get RecordCRUDService instance (singleton)
   * TODO: Uncomment when RecordCRUDService is implemented
   */
  /*
  getRecordCRUDService() {
    if (!this._recordCRUDService) {
      this._recordCRUDService = new RecordCRUDService({
        MedicalRecord: this.deps.MedicalRecord,
        Patient: this.deps.Patient,
        cacheService: this.deps.cacheService
      });
    }
    return this._recordCRUDService;
  }
  */

  /**
   * Get TrialMatchOrchestrator instance (singleton)
   * TODO: Uncomment when TrialMatchOrchestrator is implemented
   */
  /*
  getTrialMatchOrchestrator() {
    if (!this._trialMatchOrchestrator) {
      this._trialMatchOrchestrator = new TrialMatchOrchestrator({
        trialMatchingEngine: this.deps.trialMatchingEngine,
        trialMatchService: this.deps.trialMatchService,
        hybridMatchingService: this.deps.hybridMatchingService,
        enhancedTrialMatcher: this.deps.enhancedTrialMatcher,
        trialCache: this.deps.trialCache,
        cacheService: this.deps.cacheService,
        MedicalRecord: this.deps.MedicalRecord
      });
    }
    return this._trialMatchOrchestrator;
  }
  */

  /**
   * Get BatchMatchCoordinator instance (singleton)
   * TODO: Uncomment when BatchMatchCoordinator is implemented
   */
  /*
  getBatchMatchCoordinator() {
    if (!this._batchMatchCoordinator) {
      this._batchMatchCoordinator = new BatchMatchCoordinator({
        matchJobManager: this.deps.matchJobManager,
        trialMatchingEngine: this.deps.trialMatchingEngine,
        MedicalRecord: this.deps.MedicalRecord
      });
    }
    return this._batchMatchCoordinator;
  }
  */

  /**
   * Get MatchHistoryService instance (singleton)
   * TODO: Uncomment when MatchHistoryService is implemented
   */
  /*
  getMatchHistoryService() {
    if (!this._matchHistoryService) {
      this._matchHistoryService = new MatchHistoryService({
        MedicalRecord: this.deps.MedicalRecord
      });
    }
    return this._matchHistoryService;
  }
  */

  /**
   * Reset all service instances (useful for testing)
   */
  reset() {
    this._recordProcessingService = null;
    this._recordCRUDService = null;
    this._trialMatchOrchestrator = null;
    this._batchMatchCoordinator = null;
    this._matchHistoryService = null;
  }
}

// Export singleton instance for production use
const defaultContainer = new ServiceContainer();

module.exports = {
  ServiceContainer,
  defaultContainer
};
