# Phase 1 Architecture Documentation

**Version:** 1.0  
**Date:** 2025-10-07  
**Status:** Design Phase

---

## Overview

This document provides detailed architecture diagrams and technical specifications for the Phase 1 refactoring of the clinical-trial matching backend.

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│                    (React/Next.js Frontend)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/REST
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                           │
│                   (Express.js Routes)                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  /api/medical/*  (25 endpoints)                          │  │
│  │  - Authentication Middleware                             │  │
│  │  - Rate Limiting                                         │  │
│  │  - Request Validation                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Controller Layer                             │
│                  (medicalController.js)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Feature Flag Check                                      │  │
│  │  ├─ if (useRefactoredServices) → New Services           │  │
│  │  └─ else → Legacy Monolithic Code                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer (NEW)                         │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ Record         │  │ Record         │  │ Trial Match     │  │
│  │ Processing     │  │ CRUD           │  │ Orchestrator    │  │
│  │ Service        │  │ Service        │  │                 │  │
│  └────────────────┘  └────────────────┘  └─────────────────┘  │
│  ┌────────────────┐  ┌────────────────┐                        │
│  │ Batch Match    │  │ Match History  │                        │
│  │ Coordinator    │  │ Service        │                        │
│  └────────────────┘  └────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   External Services Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ OCR      │  │ LLM      │  │ Trial    │  │ Cache    │       │
│  │ Service  │  │ Service  │  │ Matching │  │ (Redis)  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Data Layer                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MongoDB                                                  │  │
│  │  ├─ MedicalRecord Collection                             │  │
│  │  ├─ Patient Collection                                   │  │
│  │  ├─ ClinicalTrial Collection                             │  │
│  │  └─ ClinicalEntity Collection (NEW)                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Service Decomposition

### 1. RecordProcessingService

**Purpose:** Coordinate OCR, text parsing, and LLM integration

```
┌─────────────────────────────────────────────────────────┐
│         RecordProcessingService                          │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Public Methods:                                         │
│  ├─ processUploadedFiles(files, options)                │
│  ├─ extractTextFromFile(file, template)                 │
│  ├─ parseTextToStructured(text, options)                │
│  ├─ extractSpecificFields(text, fields, recordId)       │
│  ├─ integrateMedicalRecord(text, existingArchive)       │
│  ├─ startStepwiseExtraction(text, patientId, options)   │
│  ├─ getExtractionStatus(jobId)                          │
│  ├─ getExtractionResult(jobId)                          │
│  └─ checkOCRHealth()                                     │
│                                                           │
│  Dependencies:                                           │
│  ├─ ocrService                                           │
│  ├─ llmService                                           │
│  ├─ stepwiseLLMService                                   │
│  ├─ MedicalRecord (model)                               │
│  ├─ Patient (model)                                     │
│  └─ cacheService                                         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Data Flow:**

```
Upload Files
     │
     ▼
processUploadedFiles()
     │
     ├─► extractTextFromFile() ──► OCR Service
     │                                  │
     │                                  ▼
     │                            Raw Text
     │
     ▼
parseTextToStructured()
     │
     ├─► if (useLLM) ──► LLM Service ──► Structured Data
     │
     └─► else ──► Heuristic Parser ──► Structured Data
     │
     ▼
Save to MedicalRecord
```

---

### 2. RecordCRUDService

**Purpose:** Medical record lifecycle management

```
┌─────────────────────────────────────────────────────────┐
│            RecordCRUDService                             │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Public Methods:                                         │
│  ├─ createRecord(userId, recordData)                    │
│  ├─ createRecordFromOCR(userId, ocrData)               │
│  ├─ listRecords(userId, filters)                        │
│  ├─ getRecordById(recordId, userId)                     │
│  ├─ updateRecord(recordId, userId, updates)             │
│  ├─ deleteRecord(recordId, userId)                      │
│  ├─ linkRecordToPatient(recordId, patientId, userId)   │
│  ├─ unlinkRecordFromPatient(recordId, userId)          │
│  ├─ invalidateRecordCache(recordId, userId)            │
│  └─ refreshPatientLatestData(patientId, userId)        │
│                                                           │
│  Dependencies:                                           │
│  ├─ MedicalRecord (model)                               │
│  ├─ Patient (model)                                     │
│  └─ cacheService                                         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**CRUD Operations Flow:**

```
Create:
  User Request ──► createRecord() ──► Validate Data
                                          │
                                          ▼
                                   Save to MongoDB
                                          │
                                          ▼
                                   Invalidate Cache
                                          │
                                          ▼
                                   Return Record

Update:
  User Request ──► updateRecord() ──► Fetch Record
                                          │
                                          ▼
                                   Check Ownership
                                          │
                                          ▼
                                   Apply Updates
                                          │
                                          ▼
                                   Save Changes
                                          │
                                          ▼
                                   Invalidate Cache
                                          │
                                          ▼
                                   Update Patient Link
                                          │
                                          ▼
                                   Return Updated Record
```

---

### 3. TrialMatchOrchestrator

**Purpose:** Matching strategy selection and coordination

```
┌─────────────────────────────────────────────────────────┐
│          TrialMatchOrchestrator                          │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Public Methods:                                         │
│  ├─ matchWithStrategy(recordOrData, strategy, options)  │
│  ├─ matchClassic(structuredData, options)               │
│  ├─ matchWithLLM(structuredData, options)               │
│  ├─ matchHybrid(structuredData, options)                │
│  ├─ matchEnhanced(structuredData, options)              │
│  ├─ matchAllTrials(structuredData, paginationOptions)   │
│  ├─ attachMetadata(matches, trialLookup)                │
│  ├─ validateAndNormalize(matches, source)               │
│  ├─ getCachedMatch(cacheKey)                            │
│  └─ setCachedMatch(cacheKey, result, ttl)               │
│                                                           │
│  Dependencies:                                           │
│  ├─ trialMatchingEngine (classic)                       │
│  ├─ trialMatchService (LLM)                             │
│  ├─ hybridMatchingService                               │
│  ├─ enhancedTrialMatcher                                │
│  ├─ trialCache                                           │
│  ├─ cacheService                                         │
│  └─ MedicalRecord (model)                               │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Strategy Selection Logic:**

```
matchWithStrategy(data, strategy='auto')
     │
     ▼
if strategy == 'auto':
     │
     ├─► Check data completeness
     │        │
     │        ├─► High quality → Hybrid Matching
     │        ├─► Medium quality → Classic Matching
     │        └─► Low quality → Enhanced Matching
     │
else if strategy == 'classic':
     │
     └─► matchClassic() ──► Rule-based Engine
     
else if strategy == 'llm':
     │
     └─► matchWithLLM() ──► LLM Service
     
else if strategy == 'hybrid':
     │
     └─► matchHybrid() ──► Hybrid Service
     
else if strategy == 'enhanced':
     │
     └─► matchEnhanced() ──► Enhanced Matcher
     
     │
     ▼
Validate Results
     │
     ▼
Attach Metadata
     │
     ▼
Cache Results
     │
     ▼
Return Matches
```

---

### 4. BatchMatchCoordinator

**Purpose:** Batch processing and SSE streaming

```
┌─────────────────────────────────────────────────────────┐
│          BatchMatchCoordinator                           │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Public Methods:                                         │
│  ├─ startBatchJob(recordId, userId, options)            │
│  ├─ getBatchJobStatus(jobId, userId)                    │
│  ├─ cancelBatchJob(jobId, userId)                       │
│  ├─ processSingleBatch(recordId, userId, options)       │
│  ├─ executeBatchMatch(record, structuredData, options)  │
│  ├─ setupSSEStream(res, jobId, recordId, userId)        │
│  ├─ createSSEEventWriter(res)                           │
│  ├─ getBatchProgress(recordId, userId)                  │
│  └─ updateBatchProgress(recordId, batchInfo)            │
│                                                           │
│  Dependencies:                                           │
│  ├─ matchJobManager                                      │
│  ├─ trialMatchingEngine                                  │
│  └─ MedicalRecord (model)                               │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**SSE Streaming Flow:**

```
Client Request
     │
     ▼
startBatchJob()
     │
     ├─► Create Job in JobManager
     │
     ├─► Initialize EventEmitter
     │
     └─► Return jobId
     
Client Connects to SSE
     │
     ▼
setupSSEStream()
     │
     ├─► Set SSE Headers
     │
     ├─► Send Initial Event
     │
     ├─► Listen to JobManager Events
     │        │
     │        ├─► 'batch' event ──► Send batch data
     │        ├─► 'progress' event ──► Send progress
     │        ├─► 'complete' event ──► Send final results
     │        └─► 'error' event ──► Send error
     │
     └─► Cleanup on disconnect
```

---

### 5. MatchHistoryService

**Purpose:** Match snapshot management and replay

```
┌─────────────────────────────────────────────────────────┐
│           MatchHistoryService                            │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Public Methods:                                         │
│  ├─ saveMatchSnapshot(record, matches, metadata, userId)│
│  ├─ getMatchHistory(recordId, userId, options)          │
│  ├─ getHistoryEntry(recordId, historyId, userId)        │
│  ├─ restoreFromHistory(recordId, historyId, userId)     │
│  ├─ compareHistoryEntries(recordId, id1, id2, userId)   │
│  ├─ pruneOldHistory(recordId, keepCount)                │
│  ├─ deleteHistoryEntry(recordId, historyId, userId)     │
│  ├─ getMatchTrends(recordId, userId)                    │
│  └─ getProviderStats(recordId, userId)                  │
│                                                           │
│  Dependencies:                                           │
│  └─ MedicalRecord (model)                               │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**History Management:**

```
Match Completed
     │
     ▼
saveMatchSnapshot()
     │
     ├─► Create History Entry
     │        │
     │        ├─ matches: Array
     │        ├─ metadata: Object
     │        ├─ createdAt: Date
     │        └─ _id: ObjectId
     │
     ├─► Append to matchHistory Array
     │
     ├─► Update matchResults (current)
     │
     └─► Save Record

Restore from History
     │
     ▼
restoreFromHistory()
     │
     ├─► Find History Entry by ID
     │
     ├─► Copy matches to matchResults
     │
     ├─► Update metadata
     │
     └─► Save Record
```

---

## Data Models

### Clinical Entity Schema (NEW)

```
ClinicalEntity (Base Schema)
├─ code: String (indexed)
├─ system: String (e.g., 'ICD-10', 'SNOMED-CT')
├─ display: String (required)
├─ confidence: Number (0-1)
├─ source: Enum ['llm', 'manual', 'ocr', 'imported']
├─ extractedAt: Date
├─ validated: Boolean
├─ validatedBy: ObjectId (ref: User)
├─ validatedAt: Date
└─ entityType: String (discriminator key)

Diagnosis (extends ClinicalEntity)
├─ primaryDiagnosis: Boolean
├─ stage: String
├─ grade: String
├─ stagingSystem: Enum
├─ stagingValue: String
├─ pathologyType: String
├─ histology: String
├─ metastasisSites: [String]
├─ diagnosisDate: Date
└─ onsetDate: Date

Medication (extends ClinicalEntity)
├─ genericName: String
├─ brandName: String
├─ drugClass: String
├─ dose: String
├─ doseUnit: String
├─ frequency: String
├─ route: Enum
├─ indication: String
├─ treatmentLine: Number
├─ startDate: Date
├─ endDate: Date
├─ duration: String
├─ response: Enum
├─ adverseEvents: [String]
└─ discontinuedReason: String

Biomarker (extends ClinicalEntity)
├─ biomarkerType: Enum
├─ gene: String
├─ variant: String
├─ testMethod: String
├─ testDate: Date
├─ status: Enum
├─ value: String
├─ unit: String
├─ referenceRange: String
├─ clinicalSignificance: Enum
├─ allelicFrequency: Number
├─ copyNumber: Number
└─ expressionLevel: String

LabResult (extends ClinicalEntity)
├─ testName: String (required)
├─ testCategory: Enum
├─ value: Mixed (required)
├─ unit: String
├─ referenceRange: Object
│   ├─ min: Number
│   ├─ max: Number
│   └─ text: String
├─ abnormalFlag: Enum
├─ interpretation: String
├─ testDate: Date (required)
├─ specimenType: String
├─ collectionDate: Date
├─ performingLab: String
└─ orderingProvider: String
```

---

## Feature Flag Architecture

### Flag Evaluation Flow

```
Request Arrives
     │
     ▼
Controller Function
     │
     ▼
featureFlags.isEnabled('use_refactored_services', { userId })
     │
     ├─► Check Percentage Rollout
     │        │
     │        ├─► if configured:
     │        │        │
     │        │        ├─► Hash userId
     │        │        │
     │        │        └─► return (hash % 100) < percentage
     │        │
     │        └─► else: continue
     │
     ├─► Check User Override (Redis)
     │        │
     │        └─► if exists: return override value
     │
     └─► Return Default Flag Value
     
     │
     ▼
if (enabled):
     │
     └─► Execute New Service Code
     
else:
     │
     └─► Execute Legacy Code
```

### Flag Configuration

```
Environment Variables:
├─ FEATURE_USE_REFACTORED_SERVICES=false
├─ FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=0
├─ FEATURE_ENABLE_CLINICAL_ENTITIES=false
├─ FEATURE_ENABLE_HYBRID_MATCHING=true
└─ ... (other flags)

Redis Overrides (optional):
├─ flag:user:{userId}:use_refactored_services = "true"
└─ flag:user:{userId}:enable_clinical_entities = "false"
```

---

## Dependency Injection

### ServiceContainer Pattern

```
┌─────────────────────────────────────────────────────────┐
│              ServiceContainer                            │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Constructor Dependencies:                               │
│  ├─ ocrService                                           │
│  ├─ llmService                                           │
│  ├─ stepwiseLLMService                                   │
│  ├─ trialMatchService                                    │
│  ├─ trialMatchingEngine                                  │
│  ├─ hybridMatchingService                                │
│  ├─ enhancedTrialMatcher                                 │
│  ├─ matchJobManager                                      │
│  ├─ trialCache                                           │
│  ├─ cacheService                                         │
│  ├─ MedicalRecord                                        │
│  └─ Patient                                              │
│                                                           │
│  Service Getters (Lazy Loading):                         │
│  ├─ getRecordProcessingService()                         │
│  ├─ getRecordCRUDService()                               │
│  ├─ getTrialMatchOrchestrator()                          │
│  ├─ getBatchMatchCoordinator()                           │
│  └─ getMatchHistoryService()                             │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Usage in Controller:**

```javascript
// Production
const { defaultContainer } = require('../services/ServiceContainer');
const recordProcessingService = defaultContainer.getRecordProcessingService();

// Testing
const { ServiceContainer } = require('../services/ServiceContainer');
const mockContainer = new ServiceContainer({
  ocrService: mockOCRService,
  llmService: mockLLMService,
  // ... other mocks
});
const testService = mockContainer.getRecordProcessingService();
```

---

## Testing Architecture

### Test Pyramid

```
                    ┌─────────────┐
                    │   E2E Tests │  (10%)
                    │   ~5 tests  │
                    └─────────────┘
                          │
                ┌─────────────────────┐
                │ Integration Tests   │  (30%)
                │    ~20 tests        │
                └─────────────────────┘
                          │
            ┌─────────────────────────────┐
            │      Unit Tests             │  (60%)
            │      ~100 tests             │
            └─────────────────────────────┘
```

### Test Structure

```
server/test/
├─ setup.js (MongoDB Memory Server, mocks)
├─ unit/
│  ├─ services/
│  │  ├─ RecordProcessingService.test.js
│  │  ├─ RecordCRUDService.test.js
│  │  ├─ TrialMatchOrchestrator.test.js
│  │  ├─ BatchMatchCoordinator.test.js
│  │  └─ MatchHistoryService.test.js
│  ├─ models/
│  │  ├─ Diagnosis.test.js
│  │  ├─ Medication.test.js
│  │  ├─ Biomarker.test.js
│  │  └─ LabResult.test.js
│  └─ utils/
│     └─ FeatureFlagService.test.js
├─ integration/
│  ├─ recordProcessing.integration.test.js
│  ├─ recordCRUD.integration.test.js
│  ├─ trialMatching.integration.test.js
│  └─ endToEnd.integration.test.js
├─ regression/
│  └─ apiContract.regression.test.js
├─ performance/
│  └─ matchingPerformance.test.js
└─ fixtures/
   ├─ mockRecords.js
   ├─ mockTrials.js
   └─ mockOCRResults.js
```

---

## Deployment Architecture

### Rollout Stages

```
Stage 1: Development (Week 1-2)
├─ All flags ON
├─ Full test suite
└─ Local testing

Stage 2: Staging (Week 3)
├─ All flags ON
├─ Integration testing
└─ Performance baseline

Stage 3: Canary (Week 4, Day 1-2)
├─ FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=5
├─ Monitor metrics
└─ Rollback if issues

Stage 4: Gradual Rollout (Week 4, Day 3-6)
├─ Day 3: 10%
├─ Day 4: 25%
├─ Day 5: 50%
└─ Day 6: 75%

Stage 5: Full Rollout (Week 4, Day 7)
├─ FEATURE_USE_REFACTORED_SERVICES=true
├─ FEATURE_USE_REFACTORED_SERVICES_PERCENTAGE=100
└─ Monitor for 48 hours

Stage 6: Cleanup (Post-rollout)
├─ Remove feature flag checks
├─ Delete legacy code
└─ Update documentation
```

### Monitoring Metrics

```
Performance Metrics:
├─ P50 Latency
├─ P95 Latency
├─ P99 Latency
├─ Throughput (requests/sec)
├─ Error Rate (%)
└─ Memory Usage (MB)

Business Metrics:
├─ Match Success Rate
├─ Match Quality Score
├─ User Satisfaction
└─ API Usage Patterns

System Metrics:
├─ CPU Usage
├─ Database Connections
├─ Cache Hit Rate
└─ External Service Latency
```

---

## Security Considerations

### Authentication & Authorization

```
Request Flow:
├─ authenticateToken middleware
│  ├─ Verify JWT
│  ├─ Extract userId
│  └─ Attach to req.userId
│
├─ Controller
│  ├─ Check ownership (userId matches)
│  └─ Validate permissions
│
└─ Service Layer
   └─ Trust userId from controller
```

### Data Access Control

```
Record Access:
├─ Users can only access their own records
├─ Query: { _id: recordId, userId: req.userId }
└─ Prevents unauthorized access

Patient Linking:
├─ Verify patient ownership before linking
├─ Query: { _id: patientId, userId: req.userId }
└─ Prevents cross-user data leakage
```

---

## Performance Optimization

### Caching Strategy

```
Cache Layers:
├─ L1: In-Memory (Node.js)
│  ├─ Trial data (trialCache)
│  └─ Feature flags
│
├─ L2: Redis
│  ├─ Match results (10 min TTL)
│  ├─ Record lists (2 min TTL)
│  └─ User overrides
│
└─ L3: MongoDB
   └─ Persistent storage
```

### Database Indexing

```
MedicalRecord:
├─ { userId: 1, uploadDate: -1 }
├─ { patientId: 1 }
└─ { _id: 1, userId: 1 }

Patient:
├─ { userId: 1, patientId: 1 } (unique)
└─ { userId: 1, updatedAt: -1 }

ClinicalEntity:
├─ { code: 1, system: 1 }
└─ { entityType: 1 }
```

---

## Error Handling

### Error Flow

```
Service Layer Error
     │
     ▼
Throw HttpError / Custom Error
     │
     ▼
Controller Catch Block
     │
     ▼
next(error)
     │
     ▼
Express Error Middleware
     │
     ├─► Log Error
     ├─► Format Response
     └─► Send to Client
```

### Error Types

```
HttpError
├─ BadRequestError (400)
├─ UnauthorizedError (401)
├─ ForbiddenError (403)
├─ NotFoundError (404)
└─ InternalServerError (500)
```

---

## Conclusion

This architecture provides:
- **Modularity**: Clear service boundaries
- **Testability**: Dependency injection enables mocking
- **Scalability**: Services can be independently scaled
- **Maintainability**: Smaller, focused modules
- **Safety**: Feature flags enable gradual rollout
- **Backward Compatibility**: Zero breaking changes

**Next Steps:**
1. Review and approve architecture
2. Begin Week 1 implementation
3. Set up monitoring and alerting
4. Prepare rollback procedures

---

**Document Status:** ✅ Ready for Review  
**Last Updated:** 2025-10-07
