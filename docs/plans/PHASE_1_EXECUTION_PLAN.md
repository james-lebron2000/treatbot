# Phase 1 Execution Plan: Foundation Refactoring

**Document Version:** 1.0  
**Created:** 2025-10-07  
**Target Completion:** 4 weeks (2025-11-04)  
**Status:** Planning

---

## Executive Summary

This plan details the refactoring of the clinical-trial matching backend's monolithic `medicalController.js` (~2050 lines) into 5 focused services, establishing a robust testing infrastructure, and implementing feature flags for safe deployment. All 25 existing API endpoints will remain backward-compatible.

### Key Objectives
- **Service Decomposition**: Split controller into 5 services (<200 lines each)
- **Data Model Foundation**: Base schemas for Diagnosis/Medication/Biomarker/LabResult
- **Testing Infrastructure**: Jest + Supertest with 60% overall coverage (90% for matching engine)
- **Feature Flags**: Safe rollout and rollback capabilities
- **Zero Breaking Changes**: All 25 API endpoints remain unchanged

---

## Table of Contents
1. [Current State Analysis](#1-current-state-analysis)
2. [Target Architecture](#2-target-architecture)
3. [Service Decomposition Plan](#3-service-decomposition-plan)
4. [Data Model Design](#4-data-model-design)
5. [Feature Flag Infrastructure](#5-feature-flag-infrastructure)
6. [Testing Strategy](#6-testing-strategy)
7. [Migration Timeline](#7-migration-timeline)
8. [Risk Assessment & Mitigation](#8-risk-assessment--mitigation)
9. [Success Criteria](#9-success-criteria)
10. [Next Steps Checklist](#10-next-steps-checklist)

---

## 1. Current State Analysis

### 1.1 Existing Controller Structure

**File:** `server/controllers/medicalController.js`  
**Lines of Code:** 2050  
**Exported Functions:** 24

#### Function Breakdown by Category

**OCR & Record Processing (6 functions)**
- `uploadMedicalFiles` - Multi-file OCR processing
- `createRecordFromOCR` - Create record from OCR result
- `parseMedicalText` - Parse text with optional LLM
- `extractFieldsWithLLM` - Field-specific extraction
- `integrateMedicalRecord` - Full LLM integration
- `ocrHealthCheck` - OCR service health

**Record CRUD (4 functions)**
- `listMedicalRecords` - List user's records
- `getMedicalRecord` - Get single record
- `updateMedicalRecord` - Update record
- `deleteMedicalRecord` - Delete record

**Trial Matching (7 functions)**
- `matchClinicalTrials` - Classic rule-based matching
- `matchClinicalTrialsWithLLM` - LLM-enhanced matching
- `matchTrialsWithStructuredData` - Enhanced matching with archive
- `matchAllClinicalTrials` - Continuous matching with pagination
- `startMatchJob` - Initiate batch matching job
- `streamMatchJob` - SSE streaming for batch results
- `processBatchMatch` - Process single batch

**Match History (3 functions)**
- `getMatchHistory` - Retrieve match history
- `restoreMatchHistory` - Restore previous match
- `getBatchMatchStatus` - Get batch progress

**Stepwise Extraction (3 functions)**
- `startStepwiseExtraction` - Start multi-step extraction
- `getExtractionStatus` - Poll extraction status
- `getExtractionResult` - Get final extraction result

### 1.2 Dependencies Analysis

**External Services:**
- `AlibabaOCRService` - OCR processing
- `LLMIntegrationService` - Full record integration
- `StepwiseLLMService` - Multi-step extraction
- `TrialMatchingService` - LLM matching
- `trialMatchingEngine` - Rule-based engine
- `hybridMatchingService` - Hybrid approach
- `matchJobManager` - Batch job coordination
- `enhancedTrialMatcher` - Archive-based matching

**Data Models:**
- `MedicalRecord` - Primary record model
- `Patient` - Patient entity
- `ClinicalTrial` - Trial data (read-only)

**Utilities:**
- `trialCache` - Trial data caching
- `cacheService` - Redis caching
- `patientArchive` - Clinical archive utilities
- `recordNormalizer` - Data normalization
- `matchResultValidator` - Result validation

### 1.3 API Endpoints (25 total)

**Routes defined in `server/routes/medical.js`:**

```javascript
// OCR & Parsing (5)
POST   /api/medical/upload
POST   /api/medical/records/from-ocr
POST   /api/medical/parse
POST   /api/medical/integrate
POST   /api/medical/extract/fields

// Record CRUD (4)
GET    /api/medical/records
GET    /api/medical/records/:id
PUT    /api/medical/records/:id
DELETE /api/medical/records/:id

// Matching (5)
POST   /api/medical/match
POST   /api/medical/match/llm
POST   /api/medical/match/enhanced
POST   /api/medical/match/batch/:recordId
GET    /api/medical/match/batch/:recordId/status

// Match History (3)
GET    /api/medical/match/history/:recordId
POST   /api/medical/match/history/:recordId/restore
GET    /api/medical/match/stream/:recordId

// Stepwise Extraction (3)
POST   /api/medical/extract/stepwise
GET    /api/medical/extract/status/:jobId
GET    /api/medical/extract/result/:jobId

// Health (1)
GET    /api/medical/ocr/health
```

### 1.4 Current Issues

1. **Monolithic Controller**: 2050 lines, difficult to test and maintain
2. **Mixed Concerns**: OCR, CRUD, matching, and history in one file
3. **Tight Coupling**: Direct service instantiation in controller
4. **Limited Testing**: Only 6 test files, no controller tests
5. **No Feature Flags**: Cannot safely roll out changes
6. **Inconsistent Error Handling**: Mix of try-catch and error propagation
7. **Cache Key Duplication**: Cache keys scattered throughout

---

## 2. Target Architecture

### 2.1 Service Layer Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    medicalController.js                      │
│                    (Slim orchestrator)                       │
│                         ~150 lines                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ delegates to
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Service Layer                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────┐  ┌────────────────────┐            │
│  │ RecordProcessing   │  │   RecordCRUD       │            │
│  │     Service        │  │    Service         │            │
│  │   (~180 lines)     │  │  (~150 lines)      │            │
│  └────────────────────┘  └────────────────────┘            │
│                                                               │
│  ┌────────────────────┐  ┌────────────────────┐            │
│  │ TrialMatch         │  │  BatchMatch        │            │
│  │  Orchestrator      │  │  Coordinator       │            │
│  │   (~190 lines)     │  │  (~180 lines)      │            │
│  └────────────────────┘  └────────────────────┘            │
│                                                               │
│  ┌────────────────────┐                                     │
│  │  MatchHistory      │                                     │
│  │    Service         │                                     │
│  │   (~120 lines)     │                                     │
│  └────────────────────┘                                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Existing Services (unchanged)                   │
│  ocrService, llmIntegrationService, trialMatchingEngine...  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Dependency Injection Pattern

```javascript
// services/ServiceContainer.js
class ServiceContainer {
  constructor(dependencies = {}) {
    this.deps = {
      ocrService: dependencies.ocrService || new AlibabaOCRService(),
      llmService: dependencies.llmService || new LLMIntegrationService(),
      // ... other services
    };
  }

  getRecordProcessingService() {
    return new RecordProcessingService(this.deps);
  }
  
  // ... other getters
}

// In controller
const container = new ServiceContainer();
const recordProcessingService = container.getRecordProcessingService();
```

---

## 3. Service Decomposition Plan

### 3.1 RecordProcessingService

**Responsibility:** OCR coordination, text parsing, LLM integration

**File:** `server/services/recordProcessing/RecordProcessingService.js`

**Methods:**
```javascript
class RecordProcessingService {
  constructor({ ocrService, llmService, stepwiseLLMService }) {
    this.ocrService = ocrService;
    this.llmService = llmService;
    this.stepwiseLLMService = stepwiseLLMService;
  }

  // OCR Processing
  async processUploadedFiles(files, options = {}) { }
  async extractTextFromFile(file, template) { }
  
  // Text Parsing
  async parseTextToStructured(text, options = {}) { }
  async extractSpecificFields(text, fields, recordId) { }
  
  // LLM Integration
  async integrateMedicalRecord(text, existingArchive) { }
  
  // Stepwise Extraction
  async startStepwiseExtraction(text, patientId, options) { }
  async getExtractionStatus(jobId) { }
  async getExtractionResult(jobId) { }
  
  // Health Check
  async checkOCRHealth() { }
}
```

**Migrated Controller Functions:**
- `uploadMedicalFiles` → `processUploadedFiles`
- `parseMedicalText` → `parseTextToStructured`
- `extractFieldsWithLLM` → `extractSpecificFields`
- `integrateMedicalRecord` → `integrateMedicalRecord`
- `startStepwiseExtraction` → `startStepwiseExtraction`
- `getExtractionStatus` → `getExtractionStatus`
- `getExtractionResult` → `getExtractionResult`
- `ocrHealthCheck` → `checkOCRHealth`

**Lines of Code:** ~180

---

### 3.2 RecordCRUDService

**Responsibility:** Medical record lifecycle management

**File:** `server/services/recordCRUD/RecordCRUDService.js`

**Methods:**
```javascript
class RecordCRUDService {
  constructor({ cacheService, patientService }) {
    this.cacheService = cacheService;
    this.patientService = patientService;
  }

  // CRUD Operations
  async createRecord(userId, recordData) { }
  async createRecordFromOCR(userId, ocrData) { }
  async listRecords(userId, filters = {}) { }
  async getRecordById(recordId, userId) { }
  async updateRecord(recordId, userId, updates) { }
  async deleteRecord(recordId, userId) { }
  
  // Patient Linking
  async linkRecordToPatient(recordId, patientId, userId) { }
  async unlinkRecordFromPatient(recordId, userId) { }
  
  // Cache Management
  async invalidateRecordCache(recordId, userId) { }
  async refreshPatientLatestData(patientId, userId) { }
}
```

**Migrated Controller Functions:**
- `createRecordFromOCR` → `createRecordFromOCR`
- `listMedicalRecords` → `listRecords`
- `getMedicalRecord` → `getRecordById`
- `updateMedicalRecord` → `updateRecord`
- `deleteMedicalRecord` → `deleteRecord`

**Lines of Code:** ~150

---

### 3.3 TrialMatchOrchestrator

**Responsibility:** Matching strategy selection and coordination

**File:** `server/services/matching/TrialMatchOrchestrator.js`

**Methods:**
```javascript
class TrialMatchOrchestrator {
  constructor({ 
    trialMatchingEngine, 
    trialMatchService, 
    hybridMatchingService,
    enhancedTrialMatcher,
    trialCache,
    cacheService 
  }) {
    this.engines = {
      classic: trialMatchingEngine,
      llm: trialMatchService,
      hybrid: hybridMatchingService,
      enhanced: enhancedTrialMatcher
    };
    this.trialCache = trialCache;
    this.cacheService = cacheService;
  }

  // Strategy Selection
  async matchWithStrategy(recordOrData, strategy = 'auto', options = {}) { }
  
  // Individual Strategies
  async matchClassic(structuredData, options) { }
  async matchWithLLM(structuredData, options) { }
  async matchHybrid(structuredData, options) { }
  async matchEnhanced(structuredData, options) { }
  
  // Continuous Matching
  async matchAllTrials(structuredData, paginationOptions) { }
  
  // Result Processing
  async attachMetadata(matches, trialLookup) { }
  async validateAndNormalize(matches, source) { }
  
  // Caching
  async getCachedMatch(cacheKey) { }
  async setCachedMatch(cacheKey, result, ttl) { }
}
```

**Migrated Controller Functions:**
- `matchClinicalTrials` → `matchClassic`
- `matchClinicalTrialsWithLLM` → `matchWithLLM`
- `matchTrialsWithStructuredData` → `matchEnhanced`
- `matchAllClinicalTrials` → `matchAllTrials`

**Lines of Code:** ~190

---

### 3.4 BatchMatchCoordinator

**Responsibility:** Batch processing and SSE streaming

**File:** `server/services/matching/BatchMatchCoordinator.js`

**Methods:**
```javascript
class BatchMatchCoordinator {
  constructor({ matchJobManager, trialMatchingEngine }) {
    this.jobManager = matchJobManager;
    this.engine = trialMatchingEngine;
  }

  // Job Management
  async startBatchJob(recordId, userId, options = {}) { }
  async getBatchJobStatus(jobId, userId) { }
  async cancelBatchJob(jobId, userId) { }
  
  // Batch Processing
  async processSingleBatch(recordId, userId, options) { }
  async executeBatchMatch(record, structuredData, options) { }
  
  // SSE Streaming
  async setupSSEStream(res, jobId, recordId, userId) { }
  createSSEEventWriter(res) { }
  
  // Progress Tracking
  async getBatchProgress(recordId, userId) { }
  async updateBatchProgress(recordId, batchInfo) { }
}
```

**Migrated Controller Functions:**
- `startMatchJob` → `startBatchJob`
- `streamMatchJob` → `setupSSEStream`
- `processBatchMatch` → `processSingleBatch`
- `getBatchMatchStatus` → `getBatchJobStatus`

**Lines of Code:** ~180

---

### 3.5 MatchHistoryService

**Responsibility:** Match snapshot management and replay

**File:** `server/services/matching/MatchHistoryService.js`

**Methods:**
```javascript
class MatchHistoryService {
  constructor({ MedicalRecord }) {
    this.MedicalRecord = MedicalRecord;
  }

  // History Management
  async saveMatchSnapshot(record, matches, metadata, userId) { }
  async getMatchHistory(recordId, userId, options = {}) { }
  async getHistoryEntry(recordId, historyId, userId) { }
  
  // Restore Operations
  async restoreFromHistory(recordId, historyId, userId) { }
  async compareHistoryEntries(recordId, historyId1, historyId2, userId) { }
  
  // Cleanup
  async pruneOldHistory(recordId, keepCount = 10) { }
  async deleteHistoryEntry(recordId, historyId, userId) { }
  
  // Analytics
  async getMatchTrends(recordId, userId) { }
  async getProviderStats(recordId, userId) { }
}
```

**Migrated Controller Functions:**
- `getMatchHistory` → `getMatchHistory`
- `restoreMatchHistory` → `restoreFromHistory`
- Helper: `saveMatchSnapshot` (currently in matchEngineService)

**Lines of Code:** ~120

---

### 3.6 Slim Controller Structure

**File:** `server/controllers/medicalController.js` (refactored)

```javascript
const { ServiceContainer } = require('../services/ServiceContainer');

// Initialize services
const container = new ServiceContainer();
const recordProcessingService = container.getRecordProcessingService();
const recordCRUDService = container.getRecordCRUDService();
const trialMatchOrchestrator = container.getTrialMatchOrchestrator();
const batchMatchCoordinator = container.getBatchMatchCoordinator();
const matchHistoryService = container.getMatchHistoryService();

// OCR & Processing
async function uploadMedicalFiles(req, res, next) {
  try {
    const result = await recordProcessingService.processUploadedFiles(
      req.files,
      { userId: req.userId }
    );
    return res.success(result, { message: 'Files processed' });
  } catch (error) {
    return next(error);
  }
}

// ... similar thin wrappers for all 24 functions

module.exports = {
  uploadMedicalFiles,
  // ... all 24 exports
};
```

**Lines of Code:** ~150

---

## 4. Data Model Design

### 4.1 Base Schema Architecture

**File:** `server/models/clinical/index.js`

```javascript
const mongoose = require('mongoose');

// Base schema for all clinical entities
const clinicalEntitySchema = new mongoose.Schema({
  // Common fields
  code: { type: String, index: true },
  system: { type: String }, // e.g., 'ICD-10', 'SNOMED-CT', 'RxNorm'
  display: { type: String, required: true },
  
  // Metadata
  confidence: { type: Number, min: 0, max: 1 },
  source: { type: String, enum: ['llm', 'manual', 'ocr', 'imported'] },
  extractedAt: { type: Date, default: Date.now },
  
  // Validation
  validated: { type: Boolean, default: false },
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  validatedAt: { type: Date }
}, { 
  discriminatorKey: 'entityType',
  timestamps: true 
});

const ClinicalEntity = mongoose.model('ClinicalEntity', clinicalEntitySchema);
```

### 4.2 Diagnosis Schema

```javascript
const diagnosisSchema = new mongoose.Schema({
  // Specific to diagnosis
  primaryDiagnosis: { type: Boolean, default: false },
  stage: { type: String },
  grade: { type: String },
  
  // Staging systems
  stagingSystem: { 
    type: String, 
    enum: ['TNM', 'CNLC', 'BCLC', 'AJCC', 'other'] 
  },
  stagingValue: { type: String },
  
  // Pathology
  pathologyType: { type: String },
  histology: { type: String },
  
  // Metastasis
  metastasisSites: [{ type: String }],
  
  // Dates
  diagnosisDate: { type: Date },
  onsetDate: { type: Date }
});

const Diagnosis = ClinicalEntity.discriminator('Diagnosis', diagnosisSchema);
```

### 4.3 Medication Schema

```javascript
const medicationSchema = new mongoose.Schema({
  // Drug information
  genericName: { type: String },
  brandName: { type: String },
  drugClass: { type: String },
  
  // Dosage
  dose: { type: String },
  doseUnit: { type: String },
  frequency: { type: String },
  route: { type: String, enum: ['oral', 'iv', 'im', 'sc', 'topical', 'other'] },
  
  // Treatment context
  indication: { type: String },
  treatmentLine: { type: Number },
  
  // Dates
  startDate: { type: Date },
  endDate: { type: Date },
  duration: { type: String },
  
  // Outcome
  response: { 
    type: String, 
    enum: ['complete_response', 'partial_response', 'stable_disease', 'progressive_disease', 'unknown'] 
  },
  adverseEvents: [{ type: String }],
  discontinuedReason: { type: String }
});

const Medication = ClinicalEntity.discriminator('Medication', medicationSchema);
```

### 4.4 Biomarker Schema

```javascript
const biomarkerSchema = new mongoose.Schema({
  // Biomarker identification
  biomarkerType: { 
    type: String, 
    enum: ['genetic', 'protein', 'metabolic', 'imaging', 'other'] 
  },
  gene: { type: String },
  variant: { type: String },
  
  // Test details
  testMethod: { type: String },
  testDate: { type: Date },
  
  // Results
  status: { 
    type: String, 
    enum: ['positive', 'negative', 'mutated', 'wild_type', 'amplified', 'deleted', 'unknown'] 
  },
  value: { type: String },
  unit: { type: String },
  referenceRange: { type: String },
  
  // Interpretation
  clinicalSignificance: { 
    type: String, 
    enum: ['pathogenic', 'likely_pathogenic', 'uncertain', 'likely_benign', 'benign', 'unknown'] 
  },
  
  // Molecular details
  allelicFrequency: { type: Number },
  copyNumber: { type: Number },
  expressionLevel: { type: String }
});

const Biomarker = ClinicalEntity.discriminator('Biomarker', biomarkerSchema);
```

### 4.5 LabResult Schema

```javascript
const labResultSchema = new mongoose.Schema({
  // Test identification
  testName: { type: String, required: true },
  testCategory: { 
    type: String, 
    enum: ['hematology', 'chemistry', 'immunology', 'microbiology', 'pathology', 'imaging', 'other'] 
  },
  
  // Results
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  unit: { type: String },
  referenceRange: {
    min: { type: Number },
    max: { type: Number },
    text: { type: String }
  },
  
  // Interpretation
  abnormalFlag: { 
    type: String, 
    enum: ['normal', 'high', 'low', 'critical_high', 'critical_low', 'abnormal'] 
  },
  interpretation: { type: String },
  
  // Test metadata
  testDate: { type: Date, required: true },
  specimenType: { type: String },
  collectionDate: { type: Date },
  
  // Lab information
  performingLab: { type: String },
  orderingProvider: { type: String }
});

const LabResult = ClinicalEntity.discriminator('LabResult', labResultSchema);
```

### 4.6 Integration with MedicalRecord

**Update:** `server/models/index.js`

```javascript
// Add to medicalRecordSchema
const medicalRecordSchema = new mongoose.Schema({
  // ... existing fields ...
  
  // New: Structured clinical entities
  clinicalEntities: {
    diagnoses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalEntity' }],
    medications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalEntity' }],
    biomarkers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalEntity' }],
    labResults: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalEntity' }]
  },
  
  // Maintain backward compatibility
  structuredData: {
    diagnosis: String,
    stage: String,
    mutations: [String],
    age: Number,
    gender: String,
    previousTreatments: [String],
    biomarkers: Object,
    performanceStatus: String
  },
  
  // ... rest of schema
});
```

### 4.7 Migration Strategy

**Phase 1A (Week 1):** Schema definition only
- Define schemas, no data migration
- Schemas remain unused initially
- Validation and unit tests

**Phase 1B (Week 3):** Parallel population
- New extractions populate both old and new schemas
- Old schema remains source of truth
- Feature flag: `ENABLE_CLINICAL_ENTITIES`

**Phase 2 (Future):** Gradual migration
- Background job to migrate existing records
- Dual-read pattern (read from both, compare)
- Eventually deprecate old `structuredData`

---

## 5. Feature Flag Infrastructure

### 5.1 Feature Flag Service

**File:** `server/services/featureFlags/FeatureFlagService.js`

```javascript
class FeatureFlagService {
  constructor() {
    this.flags = new Map();
    this.loadFlags();
  }

  loadFlags() {
    // Load from environment variables
    const flagPrefix = 'FEATURE_';
    Object.keys(process.env).forEach(key => {
      if (key.startsWith(flagPrefix)) {
        const flagName = key.substring(flagPrefix.length).toLowerCase();
        this.flags.set(flagName, process.env[key] === 'true');
      }
    });
    
    // Default flags
    this.setDefaultFlags();
  }

  setDefaultFlags() {
    const defaults = {
      use_refactored_services: false,
      enable_clinical_entities: false,
      enable_hybrid_matching: true,
      enable_batch_streaming: true,
      enable_match_history: true,
      enable_stepwise_extraction: true,
      strict_validation: false
    };
    
    defaults.forEach((value, key) => {
      if (!this.flags.has(key)) {
        this.flags.set(key, value);
      }
    });
  }

  isEnabled(flagName, context = {}) {
    // Check user-specific overrides
    if (context.userId && this.hasUserOverride(context.userId, flagName)) {
      return this.getUserOverride(context.userId, flagName);
    }
    
    // Check percentage rollout
    if (this.hasPercentageRollout(flagName)) {
      return this.checkPercentageRollout(flagName, context);
    }
    
    // Default flag value
    return this.flags.get(flagName) || false;
  }

  // User-specific overrides (stored in Redis)
  async hasUserOverride(userId, flagName) {
    const key = `flag:user:${userId}:${flagName}`;
    return await cacheService.exists(key);
  }

  async getUserOverride(userId, flagName) {
    const key = `flag:user:${userId}:${flagName}`;
    const value = await cacheService.get(key);
    return value === 'true';
  }

  // Percentage rollout (e.g., 10% of users)
  hasPercentageRollout(flagName) {
    const percentage = process.env[`FEATURE_${flagName.toUpperCase()}_PERCENTAGE`];
    return percentage !== undefined;
  }

  checkPercentageRollout(flagName, context) {
    const percentage = parseInt(process.env[`FEATURE_${flagName.toUpperCase()}_PERCENTAGE`]);
    if (!context.userId) return false;
    
    // Deterministic hash-based rollout
    const hash = this.hashUserId(context.userId);
    return (hash % 100) < percentage;
  }

  hashUserId(userId) {
    // Simple hash for deterministic percentage rollout
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

module.exports = new FeatureFlagService();
```

### 5.2 Feature Flag Usage

**In Controller:**

```javascript
const featureFlags = require('../services/featureFlags/FeatureFlagService');

async function uploadMedicalFiles(req, res, next) {
  const useRefactoredServices = featureFlags.isEnabled('use_refactored_services', {
    userId: req.userId
  });

  if (useRefactoredServices) {
    // New service-based implementation
    const result = await recordProcessingService.processUploadedFiles(
      req.files,
      { userId: req.userId }
    );
    return res.success(result, { message: 'Files processed' });
  } else {
    // Original monolithic implementation
    // ... existing code ...
  }
}
```

### 5.3 Environment Variables

**File:** `.env.example`

```bash
# Feature Flags
FEATURE_USE_REFACTORED_SERVICES=false
FEATURE_ENABLE_CLINICAL_ENTITIES=false
FEATURE_ENABLE_HYBRID_MATCHING=true
FEATURE_ENABLE_BATCH_STREAMING=true
FEATURE_ENABLE_MATCH_HISTORY=true
FEATURE_ENABLE_STEPWISE_EXTRACTION=true
FEATURE_STRICT_VALIDATION=false

# Percentage Rollouts (0-100)
FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=0
FEATURE_ENABLE_CLINICAL_ENTITIES_PERCENTAGE=0
```

### 5.4 Rollout Strategy

**Week 1-2:** Development & Testing
- All flags OFF in production
- All flags ON in development/staging

**Week 3:** Canary Deployment (5%)
```bash
FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=5
```

**Week 4:** Gradual Rollout
- Day 1-2: 10%
- Day 3-4: 25%
- Day 5-6: 50%
- Day 7: 100%

**Rollback Plan:**
```bash
# Immediate rollback
FEATURE_USE_REFACTORED_SERVICES=false
FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=0
```

---

## 6. Testing Strategy

### 6.1 Testing Architecture

```
server/test/
├── unit/
│   ├── services/
│   │   ├── RecordProcessingService.test.js
│   │   ├── RecordCRUDService.test.js
│   │   ├── TrialMatchOrchestrator.test.js
│   │   ├── BatchMatchCoordinator.test.js
│   │   └── MatchHistoryService.test.js
│   ├── models/
│   │   ├── Diagnosis.test.js
│   │   ├── Medication.test.js
│   │   ├── Biomarker.test.js
│   │   └── LabResult.test.js
│   └── utils/
│       └── featureFlags.test.js
├── integration/
│   ├── recordProcessing.integration.test.js
│   ├── recordCRUD.integration.test.js
│   ├── trialMatching.integration.test.js
│   └── endToEnd.integration.test.js
├── regression/
│   └── apiContract.regression.test.js
├── performance/
│   └── matchingPerformance.test.js
└── fixtures/
    ├── mockRecords.js
    ├── mockTrials.js
    └── mockOCRResults.js
```

### 6.2 Test Infrastructure Setup

**File:** `server/test/setup.js`

```javascript
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

beforeAll(async () => {
  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  // Clear all collections after each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Mock external services
jest.mock('../services/ocrService');
jest.mock('../services/llmIntegrationService');
jest.mock('../services/trialMatchingService');

module.exports = {
  createMockUser: () => ({ /* ... */ }),
  createMockRecord: () => ({ /* ... */ }),
  createMockTrial: () => ({ /* ... */ })
};
```

### 6.3 Unit Test Example

**File:** `server/test/unit/services/RecordCRUDService.test.js`

```javascript
const RecordCRUDService = require('../../../services/recordCRUD/RecordCRUDService');
const { MedicalRecord, Patient } = require('../../../models');
const cacheService = require('../../../services/cache');

jest.mock('../../../services/cache');

describe('RecordCRUDService', () => {
  let service;
  let mockUserId;

  beforeEach(() => {
    service = new RecordCRUDService({ cacheService });
    mockUserId = new mongoose.Types.ObjectId();
  });

  describe('createRecord', () => {
    it('should create a new medical record', async () => {
      const recordData = {
        extractedText: 'Test medical text',
        structuredData: { diagnosis: 'Test diagnosis' }
      };

      const record = await service.createRecord(mockUserId, recordData);

      expect(record).toBeDefined();
      expect(record.userId.toString()).toBe(mockUserId.toString());
      expect(record.extractedText).toBe(recordData.extractedText);
    });

    it('should invalidate cache after creation', async () => {
      const recordData = { extractedText: 'Test' };
      
      await service.createRecord(mockUserId, recordData);

      expect(cacheService.del).toHaveBeenCalledWith(`records:${mockUserId}`);
    });
  });

  describe('updateRecord', () => {
    it('should update existing record', async () => {
      const record = await MedicalRecord.create({
        userId: mockUserId,
        extractedText: 'Original text'
      });

      const updated = await service.updateRecord(
        record._id,
        mockUserId,
        { extractedText: 'Updated text' }
      );

      expect(updated.extractedText).toBe('Updated text');
    });

    it('should throw NotFoundError for non-existent record', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(
        service.updateRecord(fakeId, mockUserId, { extractedText: 'Test' })
      ).rejects.toThrow('Medical record not found');
    });
  });

  // ... more tests
});
```

### 6.4 Integration Test Example

**File:** `server/test/integration/recordProcessing.integration.test.js`

```javascript
const request = require('supertest');
const app = require('../../index');
const { MedicalRecord } = require('../../models');
const { generateToken } = require('../../utils/auth');

describe('Record Processing Integration', () => {
  let authToken;
  let userId;

  beforeEach(async () => {
    const user = await User.create({
      email: 'test@example.com',
      password: 'hashedpassword',
      name: 'Test User'
    });
    userId = user._id;
    authToken = generateToken(user);
  });

  describe('POST /api/medical/parse', () => {
    it('should parse medical text and create record', async () => {
      const response = await request(app)
        .post('/api/medical/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: '患者，男，65岁，诊断为肝细胞癌',
          useLLM: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.structuredData).toBeDefined();
      expect(response.body.data.recordId).toBeDefined();

      // Verify record was created in DB
      const record = await MedicalRecord.findById(response.body.data.recordId);
      expect(record).toBeDefined();
      expect(record.userId.toString()).toBe(userId.toString());
    });

    it('should handle LLM parsing when enabled', async () => {
      const response = await request(app)
        .post('/api/medical/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: '患者，男，65岁，诊断为肝细胞癌',
          useLLM: true
        })
        .expect(200);

      expect(response.body.data.usedLLM).toBe(true);
      expect(response.body.data.llmResult).toBeDefined();
    });
  });

  // ... more integration tests
});
```

### 6.5 Regression Test Suite

**File:** `server/test/regression/apiContract.regression.test.js`

```javascript
const request = require('supertest');
const app = require('../../index');

describe('API Contract Regression Tests', () => {
  let authToken;

  beforeEach(async () => {
    // Setup auth
  });

  describe('All 25 API Endpoints', () => {
    const endpoints = [
      { method: 'POST', path: '/api/medical/upload', requiresFile: true },
      { method: 'POST', path: '/api/medical/records/from-ocr' },
      { method: 'POST', path: '/api/medical/parse' },
      { method: 'POST', path: '/api/medical/match' },
      { method: 'POST', path: '/api/medical/match/llm' },
      { method: 'GET', path: '/api/medical/records' },
      // ... all 25 endpoints
    ];

    endpoints.forEach(({ method, path, requiresFile }) => {
      it(`${method} ${path} should maintain response structure`, async () => {
        // Test that response structure hasn't changed
        // Even if feature flags are enabled
      });
    });
  });

  describe('Response Schema Validation', () => {
    it('should return consistent error format', async () => {
      const response = await request(app)
        .post('/api/medical/parse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ /* invalid data */ })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('error');
    });
  });
});
```

### 6.6 Coverage Targets

**Overall Coverage:** 60%
- Unit tests: 70%
- Integration tests: 50%
- Regression tests: 100% (all endpoints)

**Critical Path Coverage:** 90%
- Matching engine: 90%
- Record processing: 85%
- CRUD operations: 80%

**Jest Configuration:**

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'services/**/*.js',
    'controllers/**/*.js',
    'models/**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**'
  ],
  coverageThresholds: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60
    },
    './services/trialMatchingEngine.js': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js']
};
```

---

## 7. Migration Timeline

### Week 1: Foundation (Days 1-7)

**Days 1-2: Setup & Planning**
- [ ] Create feature flag service
- [ ] Set up Jest + Supertest infrastructure
- [ ] Create test fixtures and mocks
- [ ] Define service interfaces (TypeScript/JSDoc)

**Days 3-5: Schema Definition**
- [ ] Implement ClinicalEntity base schema
- [ ] Implement Diagnosis schema
- [ ] Implement Medication schema
- [ ] Implement Biomarker schema
- [ ] Implement LabResult schema
- [ ] Write schema unit tests

**Days 6-7: Service Container**
- [ ] Implement ServiceContainer with DI
- [ ] Create service factory methods
- [ ] Write container unit tests

**Deliverables:**
- Feature flag service (functional)
- Test infrastructure (ready)
- All 5 schemas (defined, tested)
- Service container (implemented)

---

### Week 2: Service Implementation (Days 8-14)

**Days 8-9: RecordProcessingService**
- [ ] Implement all 8 methods
- [ ] Write unit tests (target: 80% coverage)
- [ ] Integration test with mock OCR/LLM

**Days 10-11: RecordCRUDService**
- [ ] Implement all 10 methods
- [ ] Write unit tests (target: 80% coverage)
- [ ] Integration test with MongoDB

**Days 12-13: TrialMatchOrchestrator**
- [ ] Implement strategy selection logic
- [ ] Implement all 4 matching strategies
- [ ] Write unit tests (target: 90% coverage)

**Day 14: MatchHistoryService**
- [ ] Implement all 9 methods
- [ ] Write unit tests (target: 80% coverage)

**Deliverables:**
- 4 services fully implemented
- Unit tests for all services
- Integration tests passing

---

### Week 3: Batch Coordination & Controller (Days 15-21)

**Days 15-16: BatchMatchCoordinator**
- [ ] Implement job management
- [ ] Implement SSE streaming
- [ ] Write unit tests (target: 80% coverage)
- [ ] Integration test with EventEmitter

**Days 17-18: Slim Controller Refactor**
- [ ] Refactor all 24 controller functions
- [ ] Add feature flag checks
- [ ] Maintain backward compatibility
- [ ] Write controller unit tests

**Days 19-20: Integration Testing**
- [ ] End-to-end workflow tests
- [ ] API contract regression tests
- [ ] Performance baseline tests

**Day 21: Documentation**
- [ ] Update API documentation
- [ ] Service architecture diagrams
- [ ] Migration guide for future phases

**Deliverables:**
- BatchMatchCoordinator (complete)
- Refactored controller (backward-compatible)
- Full integration test suite
- Documentation updated

---

### Week 4: Testing, Deployment & Rollout (Days 22-28)

**Days 22-23: Comprehensive Testing**
- [ ] Run full regression suite
- [ ] Load testing (baseline vs. refactored)
- [ ] Security testing
- [ ] Fix any discovered issues

**Day 24: Staging Deployment**
- [ ] Deploy to staging with flags OFF
- [ ] Enable flags for internal testing
- [ ] Verify all 25 endpoints work

**Days 25-26: Canary Rollout (5%)**
- [ ] Enable `FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=5`
- [ ] Monitor error rates, latency, throughput
- [ ] Collect metrics and logs

**Day 27: Gradual Rollout**
- [ ] 10% rollout (monitor 4 hours)
- [ ] 25% rollout (monitor 4 hours)
- [ ] 50% rollout (monitor overnight)

**Day 28: Full Rollout & Retrospective**
- [ ] 100% rollout
- [ ] Remove feature flag checks (optional)
- [ ] Team retrospective
- [ ] Plan Phase 2

**Deliverables:**
- Production deployment (100% rollout)
- Performance metrics report
- Retrospective document
- Phase 2 planning kickoff

---

### Milestones Summary

| Week | Milestone | Success Criteria |
|------|-----------|------------------|
| 1 | Foundation Complete | All schemas defined, test infra ready, feature flags working |
| 2 | Services Implemented | 4/5 services complete with 80%+ unit test coverage |
| 3 | Integration Ready | Controller refactored, all integration tests passing |
| 4 | Production Rollout | 100% traffic on refactored services, zero regressions |

---

## 8. Risk Assessment & Mitigation

### 8.1 Technical Risks

**Risk 1: Service Boundary Misalignment**
- **Probability:** Medium
- **Impact:** High
- **Description:** Services may have overlapping responsibilities or unclear boundaries
- **Mitigation:**
  - Clear interface definitions before implementation
  - Code review with architecture focus
  - Refactor boundaries if issues discovered in Week 2

**Risk 2: Performance Degradation**
- **Probability:** Low
- **Impact:** High
- **Description:** Additional service layer may add latency
- **Mitigation:**
  - Performance baseline tests before refactor
  - Continuous performance monitoring during rollout
  - Optimize hot paths if >10% degradation detected

**Risk 3: Feature Flag Complexity**
- **Probability:** Medium
- **Impact:** Medium
- **Description:** Dual code paths increase complexity and bug surface
- **Mitigation:**
  - Keep flag checks at controller level only
  - Remove flags after successful rollout
  - Comprehensive regression testing

**Risk 4: Test Coverage Gaps**
- **Probability:** Medium
- **Impact:** Medium
- **Description:** May miss edge cases in 60% coverage target
- **Mitigation:**
  - Focus on critical paths (90% coverage)
  - Manual testing of complex workflows
  - Bug bash session in Week 3

**Risk 5: MongoDB Schema Migration Issues**
- **Probability:** Low
- **Impact:** Medium
- **Description:** New schemas may conflict with existing data
- **Mitigation:**
  - Phase 1A: Schema definition only (no data migration)
  - Parallel population in Phase 1B
  - Full migration deferred to Phase 2

### 8.2 Operational Risks

**Risk 6: Deployment Rollback Complexity**
- **Probability:** Low
- **Impact:** High
- **Description:** May need to rollback during production issues
- **Mitigation:**
  - Feature flags enable instant rollback
  - Maintain dual code paths for 2 weeks post-rollout
  - Automated rollback playbook

**Risk 7: Team Bandwidth**
- **Probability:** Medium
- **Impact:** Medium
- **Description:** 4-week timeline is aggressive for one developer
- **Mitigation:**
  - Prioritize core functionality over nice-to-haves
  - Defer non-critical features to Phase 2
  - Extend timeline if needed (acceptable up to 6 weeks)

**Risk 8: External Service Dependencies**
- **Probability:** Low
- **Impact:** Low
- **Description:** OCR/LLM services may change during refactor
- **Mitigation:**
  - Mock external services in tests
  - Service interfaces abstract implementation details
  - Monitor external service changes

### 8.3 Risk Matrix

| Risk | Probability | Impact | Priority | Owner |
|------|-------------|--------|----------|-------|
| Service Boundaries | Medium | High | 1 | RefactorAgent |
| Performance | Low | High | 2 | TestAgent |
| Feature Flags | Medium | Medium | 3 | RefactorAgent |
| Test Coverage | Medium | Medium | 4 | TestAgent |
| Schema Migration | Low | Medium | 5 | DataModelAgent |
| Rollback | Low | High | 6 | OrchestratorAgent |
| Team Bandwidth | Medium | Medium | 7 | OrchestratorAgent |
| External Deps | Low | Low | 8 | RefactorAgent |

---

## 9. Success Criteria

### 9.1 Functional Requirements

**Must Have (P0):**
- ✅ All 25 API endpoints maintain exact response structure
- ✅ Zero breaking changes to client applications
- ✅ Feature flags enable/disable refactored services
- ✅ All existing functionality works identically
- ✅ Regression test suite passes 100%

**Should Have (P1):**
- ✅ 60% overall test coverage
- ✅ 90% coverage for matching engine
- ✅ All 5 services implemented and tested
- ✅ All 5 schemas defined and validated
- ✅ Service container with dependency injection

**Nice to Have (P2):**
- ⚠️ Performance improvement (not degradation)
- ⚠️ Reduced code duplication
- ⚠️ Improved error messages
- ⚠️ Better logging and observability

### 9.2 Quality Metrics

**Code Quality:**
- No ESLint errors
- No critical security vulnerabilities
- Code review approval from 2+ reviewers
- Documentation coverage >80%

**Test Quality:**
- All tests pass consistently
- No flaky tests
- Test execution time <5 minutes
- Coverage reports generated

**Performance:**
- P95 latency: No more than 10% increase
- Throughput: No degradation
- Memory usage: No more than 15% increase
- Error rate: <0.1%

### 9.3 Deployment Success

**Staging:**
- All tests pass in staging environment
- Manual testing of critical workflows
- Load testing shows acceptable performance

**Production Rollout:**
- 5% canary: Zero errors for 24 hours
- 25% rollout: Error rate <0.1%
- 50% rollout: Performance within 10% of baseline
- 100% rollout: All metrics green for 48 hours

**Post-Rollout:**
- Zero rollbacks required
- No customer-reported issues
- Team confidence in new architecture
- Documentation complete

---

## 10. Next Steps Checklist

### Immediate Actions (Day 1)

**OrchestratorAgent:**
- [ ] Review and approve this execution plan
- [ ] Set up project tracking (Jira/Linear/GitHub Projects)
- [ ] Schedule daily standups for 4-week period
- [ ] Create feature flag configuration file

**RefactorAgent:**
- [ ] Review service boundary definitions
- [ ] Create service interface definitions (JSDoc)
- [ ] Set up service directory structure
- [ ] Create ServiceContainer skeleton

**DataModelAgent:**
- [ ] Review schema designs
- [ ] Create `server/models/clinical/` directory
- [ ] Implement ClinicalEntity base schema
- [ ] Set up schema validation tests

**TestAgent:**
- [ ] Install Jest and Supertest dependencies
- [ ] Configure Jest (jest.config.js)
- [ ] Set up MongoDB Memory Server
- [ ] Create test fixtures and mocks

### Week 1 Kickoff (Day 1-2)

- [ ] Team alignment meeting
- [ ] Git branch strategy: `feature/phase-1-refactor`
- [ ] CI/CD pipeline updates for tests
- [ ] Staging environment preparation

### Communication Plan

**Daily:**
- Standup: Progress, blockers, plan for day
- Slack updates on key milestones

**Weekly:**
- Demo of completed work
- Retrospective and plan adjustment
- Stakeholder update email

**Ad-hoc:**
- Code reviews within 24 hours
- Pair programming for complex logic
- Architecture discussions as needed

### Documentation Requirements

- [ ] Update README.md with new architecture
- [ ] Create ARCHITECTURE.md with service diagrams
- [ ] Update API documentation (Swagger/Postman)
- [ ] Write MIGRATION_GUIDE.md for Phase 2
- [ ] Update CHANGELOG.md with all changes

---

## Appendix A: Service File Structure

```
server/
├── services/
│   ├── ServiceContainer.js
│   ├── recordProcessing/
│   │   ├── RecordProcessingService.js
│   │   └── RecordProcessingService.test.js
│   ├── recordCRUD/
│   │   ├── RecordCRUDService.js
│   │   └── RecordCRUDService.test.js
│   ├── matching/
│   │   ├── TrialMatchOrchestrator.js
│   │   ├── TrialMatchOrchestrator.test.js
│   │   ├── BatchMatchCoordinator.js
│   │   ├── BatchMatchCoordinator.test.js
│   │   ├── MatchHistoryService.js
│   │   └── MatchHistoryService.test.js
│   └── featureFlags/
│       ├── FeatureFlagService.js
│       └── FeatureFlagService.test.js
├── models/
│   ├── index.js (existing)
│   └── clinical/
│       ├── index.js
│       ├── ClinicalEntity.js
│       ├── Diagnosis.js
│       ├── Medication.js
│       ├── Biomarker.js
│       └── LabResult.js
└── test/
    ├── setup.js
    ├── unit/
    ├── integration/
    ├── regression/
    ├── performance/
    └── fixtures/
```

---

## Appendix B: Code Migration Checklist

For each controller function being migrated:

- [ ] Identify service destination
- [ ] Extract business logic to service method
- [ ] Add feature flag check in controller
- [ ] Write unit tests for service method
- [ ] Write integration test for endpoint
- [ ] Update API documentation
- [ ] Code review and approval
- [ ] Merge to main branch

---

## Appendix C: Performance Baseline

**Current Performance (to be measured):**
- POST /api/medical/parse: ??? ms (P95)
- POST /api/medical/match: ??? ms (P95)
- POST /api/medical/match/llm: ??? ms (P95)
- GET /api/medical/records: ??? ms (P95)

**Action:** Run performance tests before refactor to establish baseline.

---

## Appendix D: Rollback Playbook

**Scenario 1: High Error Rate (>1%)**
1. Set `FEATURE_USE_REFACTORED_SERVICES=false`
2. Restart application servers
3. Monitor error rate for 15 minutes
4. Investigate root cause

**Scenario 2: Performance Degradation (>20%)**
1. Set `FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=0`
2. Monitor latency for 15 minutes
3. Profile slow endpoints
4. Optimize or rollback fully

**Scenario 3: Data Corruption**
1. Immediate full rollback
2. Restore from backup if needed
3. Root cause analysis
4. Fix and re-test before re-deploy

---

## Conclusion

This Phase 1 Execution Plan provides a comprehensive roadmap for refactoring the clinical-trial matching backend. The plan balances **technical excellence** with **pragmatic delivery**, ensuring zero disruption to existing functionality while establishing a solid foundation for future enhancements.

**Key Success Factors:**
1. **Incremental approach**: Small, testable changes
2. **Feature flags**: Safe rollout and instant rollback
3. **Comprehensive testing**: 60% overall, 90% critical paths
4. **Backward compatibility**: Zero breaking changes
5. **Clear ownership**: RefactorAgent, DataModelAgent, TestAgent

**Next Phase Preview:**
- Phase 2: Ontology integration (ICD-10, SNOMED-CT, RxNorm)
- Phase 3: Advanced matching algorithms
- Phase 4: Real-time collaboration features

---

**Document Status:** ✅ Ready for Review  
**Approval Required:** OrchestratorAgent, Tech Lead  
**Target Start Date:** 2025-10-08  
**Target Completion:** 2025-11-04
