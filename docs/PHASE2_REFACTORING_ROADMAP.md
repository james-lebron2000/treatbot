# 🔄 Phase 2 Refactoring Roadmap

> **Purpose**: Detailed plan for next refactoring session
> **Context**: After clearing this session, use this as starting point
> **Priority**: P0 issues addressed, now focusing on P1 improvements

---

## 🎯 Quick Context Refresh

### **What We've Done So Far**

1. ✅ Complete architecture audit (3-layer analysis)
2. ✅ Fixed P0 DI injection issue in medicalController
3. ✅ Generated audit report and quick fix documentation
4. ⏳ Ready for deeper refactoring

### **Current State**

```
Project Health: 6.5/10 → Target: 8.5/10

Critical Issues (P0):
├─ [✅] DI Injection fixed in medicalController
├─ [⏳] God Controller (2049 lines) - needs splitting
└─ [⏳] Service Redundancy (4 matching services) - needs consolidation

Files Status:
├─ medicalController.js: 2049 lines (❌ 256% over limit)
├─ trialMatchingEngine.js: 1007 lines (❌ 126% over limit)
├─ llmIntegrationService.js: 678 lines (⚠️  85% of limit)
└─ patientArchive.js: 624 lines (⚠️  78% of limit)
```

---

## 📋 Next Session Tasks

### **Task Group 1: Controller Refactoring** (Estimated: 3-4 hours)

#### **1.1 Split medicalController.js**

**Goal**: 2049 lines → 6 files averaging ~400 lines each

**Files to Create**:

```
controllers/
├── medicalController.js         (Orchestrator, ≤200 lines)
├── ocrController.js              (OCR operations, ~450 lines)
├── parsingController.js          (Text parsing, ~550 lines)
├── matchingController.js         (Trial matching, ~650 lines)
├── stepwiseExtractionController.js (Stepwise LLM, ~200 lines)
├── recordCRUDController.js       (CRUD & history, ~400 lines)
└── batchMatchingController.js    (Batch operations, ~350 lines)
```

**Template Files Available**:
- Refer to previously created `ocrController.js` and `parsingController.js` examples
- They follow the correct structure with DI Container usage

**Critical Requirements**:
- ✅ All controllers MUST use `defaultContainer` for DI
- ✅ Keep existing route paths unchanged
- ✅ Maintain request/response formats
- ✅ Add clear ASCII-art section comments

#### **1.2 Update Route Mappings**

**File**: `server/routes/medical.js`

```javascript
// Example structure
const ocrController = require('../controllers/ocrController');
const parsingController = require('../controllers/parsingController');
const matchingController = require('../controllers/matchingController');
// ... etc

router.post('/upload', authenticateToken, upload.any(), asyncHandler(ocrController.uploadMedicalFiles));
router.post('/parse', authenticateToken, asyncHandler(parsingController.parseMedicalText));
router.post('/match', authenticateToken, asyncHandler(matchingController.matchClinicalTrials));
// ... etc
```

---

### **Task Group 2: Matching Service Consolidation** (Estimated: 4-5 hours)

#### **2.1 Create Unified Facade**

**File**: `server/services/matching/TrialMatchingFacade.js`

**Design Pattern**: Strategy Pattern

```javascript
/*
 * =====================================================
 * Trial Matching Facade - 统一匹配入口
 * =====================================================
 * 职责：
 *   - 提供统一的匹配接口
 *   - 根据配置选择匹配策略
 *   - 管理策略切换和降级
 *
 * 设计模式：Strategy Pattern + Facade Pattern
 * =====================================================
 */

class TrialMatchingFacade {
  constructor(strategy = 'hybrid') {
    this.strategy = this.loadStrategy(strategy);
  }

  loadStrategy(strategyName) {
    const strategies = {
      'rule-based': new RuleBasedMatchStrategy(),
      'hybrid': new HybridMatchStrategy(),
      'llm-enhanced': new LLMEnhancedMatchStrategy()
    };
    return strategies[strategyName] || strategies['hybrid'];
  }

  async match(patientData, trials, options = {}) {
    return this.strategy.execute(patientData, trials, options);
  }

  switchStrategy(strategyName) {
    this.strategy = this.loadStrategy(strategyName);
  }
}
```

#### **2.2 Implement Strategy Classes**

**Files to Create**:

```
services/matching/
├── TrialMatchingFacade.js           (Facade, ~150 lines)
├── strategies/
│   ├── BaseMatchStrategy.js         (Abstract base, ~80 lines)
│   ├── RuleBasedMatchStrategy.js    (Consolidate engine + enhanced, ~600 lines)
│   ├── HybridMatchStrategy.js       (Keep existing logic, ~350 lines)
│   └── LLMEnhancedMatchStrategy.js  (Pure LLM mode, ~300 lines)
└── utils/
    └── matchEngineHelpers.js        (Refactor from matchEngineService, ~250 lines)
```

#### **2.3 Deprecation Plan**

**Mark as Deprecated** (but keep for backward compatibility):
- `trialMatchingEngine.js` → migrate to `RuleBasedMatchStrategy`
- `enhancedTrialMatcher.js` → merge into `RuleBasedMatchStrategy`
- `matchEngineService.js` → extract utils to `matchEngineHelpers`

**Keep as-is**:
- `hybridMatchingService.js` → wrap in `HybridMatchStrategy`

---

### **Task Group 3: Code Quality Improvements** (Estimated: 2-3 hours)

#### **3.1 Introduce DTO Pattern**

**File**: `server/dto/MatchRequest.js`

```javascript
class MatchRequest {
  constructor({ structuredData, patientId, recordId, userId, options = {} }) {
    this.structuredData = structuredData;
    this.patientId = patientId;
    this.recordId = recordId;
    this.userId = userId;
    this.options = options;
  }

  validate() {
    if (!this.structuredData) {
      throw new BadRequestError('structuredData is required');
    }
    return true;
  }

  static fromRequest(req) {
    return new MatchRequest({
      structuredData: req.body.structuredData || req.body.record,
      patientId: req.body.patientId,
      recordId: req.body.recordId,
      userId: req.userId,
      options: req.body.options || {}
    });
  }
}
```

**Usage in Controllers**:

```javascript
// Before (Data Clump)
async function matchTrials(req, res, next) {
  const { structuredData, patientId, recordId } = req.body;
  // ... 5+ parameters passed around
}

// After (DTO Pattern)
async function matchTrials(req, res, next) {
  const request = MatchRequest.fromRequest(req);
  request.validate();
  // Clean, single object passed around
}
```

#### **3.2 Standardize Naming**

**Rename Methods** (in new controllers):

```javascript
// ❌ Old names (confusing)
matchClinicalTrials()
matchClinicalTrialsWithLLM()
matchTrialsWithStructuredData()

// ✅ New names (clear)
matchTrialsClassic()
matchTrialsLLMEnhanced()
matchTrialsHybrid()
```

#### **3.3 Eliminate Special Case Branches**

**Target**: `processUploads()` function in OCR controller

**Current** (Bad Taste):
```javascript
if (req.files.length === 1) {
  const [result] = results;
  if (!result) {
    const [error] = errors;
    throw new HttpError(502, 'OCR processing failed', { ... });
  }
  return res.success({ ... }, { message: '...' });
}

return res.success({ ... }, { message: '...' });
```

**Target** (Good Taste):
```javascript
function buildOCRResponse(results, errors, stats) {
  return {
    files: results.length + errors.length === 1 ? results[0] || errors[0] : { results, errors },
    metadata: stats,
    message: buildMessage(results.length, errors.length)
  };
}

return res.success(buildOCRResponse(results, errors, stats));
```

---

## 🧪 Testing Strategy

### **After Each Task Group**

1. **Run Tests**
   ```bash
   cd server && npm test
   ```

2. **Manual Smoke Test**
   ```bash
   # Start server
   npm run server

   # Test each refactored endpoint
   curl -X POST http://localhost:5001/api/medical/upload -H "Authorization: Bearer $TOKEN" -F "file=@test.pdf"
   curl -X POST http://localhost:5001/api/medical/parse -H "Authorization: Bearer $TOKEN" -d '{"text": "..."}'
   curl -X POST http://localhost:5001/api/medical/match -H "Authorization: Bearer $TOKEN" -d '{"recordId": "..."}'
   ```

3. **Check Logs**
   - No error messages
   - DI Container usage confirmed
   - Performance benchmarks maintained

---

## 📊 Success Metrics

### **Before Refactoring**

```
✅ Code Quality: 6.5/10
⏳ medicalController: 2049 lines
⏳ 4 overlapping matching services
✅ DI Container: Fixed
```

### **Target After Refactoring**

```
✅ Code Quality: 8.5/10
✅ All files ≤ 800 lines
✅ Single matching facade with 3 strategies
✅ DTO pattern for complex parameters
✅ Consistent naming across codebase
```

---

## 🚀 Quick Start Commands (Next Session)

```bash
# 1. Read context from this file
cat docs/PHASE2_REFACTORING_ROADMAP.md

# 2. Read audit report
cat docs/ARCHITECTURE_AUDIT_REPORT.md

# 3. Check current controller structure
wc -l server/controllers/medicalController.js

# 4. Begin refactoring with Task Group 1
# Start by creating the 6 specialized controllers
```

---

## 💡 Key Principles to Remember

### **Linus Torvalds Style**

1. **Good Taste**: Eliminate special cases through better data structures
2. **Simplicity**: Keep functions short (≤30 lines), files manageable (≤800 lines)
3. **Pragmatism**: Fix real problems, not hypothetical ones
4. **Never Break Userspace**: Maintain backward compatibility

### **Code Review Checklist**

Before committing any refactoring:
- [ ] All files ≤ 800 lines
- [ ] All controllers use DI Container
- [ ] No breaking changes to API
- [ ] Tests pass
- [ ] Clear ASCII section comments added

---

## 📚 Reference Documents

1. **Architecture Audit**: `docs/ARCHITECTURE_AUDIT_REPORT.md`
2. **Quick Fix Patch**: `docs/QUICK_FIX_PATCH.md`
3. **Service Container**: `server/services/ServiceContainer.js`
4. **Project Instructions**: `CLAUDE.md`

---

**Prepared By**: Claude Code (Ultrathink Mode)
**Session**: 2025-10-07 (Context will be cleared after this)
**Status**: Ready for Phase 2 execution

---

_Use this roadmap as your starting point for the next refactoring session._
