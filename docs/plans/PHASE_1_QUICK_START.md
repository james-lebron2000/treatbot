# Phase 1 Quick Start Guide

**For:** Development Team  
**Date:** 2025-10-07  
**Estimated Time:** 30 minutes setup

---

## Prerequisites

- Node.js 16+ installed
- MongoDB running locally or accessible
- Redis (optional, for caching)
- Git repository access

---

## Day 1 Setup (30 minutes)

### 1. Install Dependencies

```bash
cd /Users/lijinming/trial-match/server

# Install Jest and testing dependencies
npm install --save-dev jest supertest mongodb-memory-server jest-junit

# Verify installation
npx jest --version
```

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env and set feature flags
nano .env
```

**Add these lines to `.env`:**

```bash
# Enable refactored services in development
FEATURE_USE_REFACTORED_SERVICES=true
FEATURE_ENABLE_CLINICAL_ENTITIES=false
```

### 3. Run Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- RecordProcessingService.test.js

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch
```

### 4. Verify Setup

```bash
# Start development server
npm run dev

# In another terminal, test API
curl http://localhost:5001/api/medical/ocr/health
```

---

## Development Workflow

### Daily Workflow

```bash
# 1. Pull latest changes
git pull origin main

# 2. Create feature branch
git checkout -b feature/week1-record-processing

# 3. Run tests before making changes
npm test

# 4. Make changes to service files
# ... edit code ...

# 5. Run tests frequently
npm test -- --watch

# 6. Commit when tests pass
git add .
git commit -m "feat: implement RecordProcessingService"

# 7. Push and create PR
git push origin feature/week1-record-processing
```

### Testing Workflow

```bash
# Run unit tests only
npm test -- test/unit

# Run integration tests only
npm test -- test/integration

# Run specific file
npm test -- RecordProcessingService.test.js

# Run with coverage threshold check
npm test -- --coverage --coverageThreshold='{"global":{"lines":60}}'

# Debug a test
node --inspect-brk node_modules/.bin/jest --runInBand RecordProcessingService.test.js
```

---

## Week 1 Tasks Checklist

### Days 1-2: Setup & Planning

- [ ] Install dependencies (`jest`, `supertest`, `mongodb-memory-server`)
- [ ] Configure `jest.config.js` (already created)
- [ ] Set up `test/setup.js` (already created)
- [ ] Create test fixtures in `test/fixtures/`
- [ ] Define service interfaces (JSDoc comments)
- [ ] Review Phase 1 Execution Plan

### Days 3-5: Schema Definition

- [ ] Create `server/models/clinical/` directory
- [ ] Implement `ClinicalEntity.js` base schema
- [ ] Implement `Diagnosis.js` schema
- [ ] Implement `Medication.js` schema
- [ ] Implement `Biomarker.js` schema
- [ ] Implement `LabResult.js` schema
- [ ] Write unit tests for each schema
- [ ] Run tests: `npm test -- test/unit/models`

### Days 6-7: Service Container

- [ ] Review `ServiceContainer.js` (already created)
- [ ] Add missing service getters if needed
- [ ] Write unit tests for ServiceContainer
- [ ] Test dependency injection with mocks
- [ ] Document usage patterns

---

## File Structure Reference

```
server/
├── services/
│   ├── ServiceContainer.js ✅ (created)
│   ├── featureFlags/
│   │   ├── FeatureFlagService.js ✅ (created)
│   │   └── FeatureFlagService.test.js ✅ (created)
│   ├── recordProcessing/
│   │   ├── RecordProcessingService.js ✅ (created)
│   │   └── RecordProcessingService.test.js ✅ (created)
│   ├── recordCRUD/
│   │   ├── RecordCRUDService.js ⏳ (to be created)
│   │   └── RecordCRUDService.test.js ⏳ (to be created)
│   └── matching/
│       ├── TrialMatchOrchestrator.js ⏳ (to be created)
│       ├── BatchMatchCoordinator.js ⏳ (to be created)
│       └── MatchHistoryService.js ⏳ (to be created)
├── models/
│   ├── index.js (existing)
│   └── clinical/
│       ├── index.js ⏳ (to be created)
│       ├── ClinicalEntity.js ⏳ (to be created)
│       ├── Diagnosis.js ⏳ (to be created)
│       ├── Medication.js ⏳ (to be created)
│       ├── Biomarker.js ⏳ (to be created)
│       └── LabResult.js ⏳ (to be created)
└── test/
    ├── setup.js ✅ (created)
    ├── unit/
    │   ├── services/ ✅ (created)
    │   ├── models/ ⏳ (to be created)
    │   └── utils/ ⏳ (to be created)
    ├── integration/ ⏳ (to be created)
    ├── regression/ ⏳ (to be created)
    └── fixtures/ ⏳ (to be created)
```

**Legend:**
- ✅ Created
- ⏳ To be created
- 🔄 In progress

---

## Common Commands

### Development

```bash
# Start development server with auto-reload
npm run dev

# Start server in production mode
npm start

# Run database setup
npm run setup
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- RecordProcessingService.test.js

# Run tests matching pattern
npm test -- --testNamePattern="should extract text"

# Update snapshots
npm test -- -u
```

### Code Quality

```bash
# Run ESLint (if configured)
npm run lint

# Fix ESLint issues
npm run lint:fix

# Check for security vulnerabilities
npm audit

# Fix security issues
npm audit fix
```

---

## Debugging Tips

### Debug Tests

```bash
# Run Jest in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand

# Then open Chrome DevTools:
# chrome://inspect
```

### Debug Application

```bash
# Start with Node debugger
node --inspect index.js

# Or with nodemon
nodemon --inspect index.js
```

### View Test Coverage

```bash
# Generate coverage report
npm test -- --coverage

# Open HTML report
open coverage/lcov-report/index.html
```

---

## Troubleshooting

### MongoDB Memory Server Issues

**Problem:** Tests fail with "MongoMemoryServer failed to start"

**Solution:**
```bash
# Clear MongoDB binaries cache
rm -rf ~/.cache/mongodb-binaries

# Re-run tests
npm test
```

### Jest Timeout Issues

**Problem:** Tests timeout after 5 seconds

**Solution:** Increase timeout in `jest.config.js`:
```javascript
testTimeout: 30000  // 30 seconds
```

### Module Not Found Errors

**Problem:** `Cannot find module '../services/...'`

**Solution:**
```bash
# Clear Jest cache
npx jest --clearCache

# Re-run tests
npm test
```

### Port Already in Use

**Problem:** "Error: listen EADDRINUSE: address already in use :::5001"

**Solution:**
```bash
# Find process using port 5001
lsof -i :5001

# Kill the process
kill -9 <PID>
```

---

## Code Review Checklist

Before submitting PR:

- [ ] All tests pass (`npm test`)
- [ ] Coverage meets threshold (60% overall, 90% for critical paths)
- [ ] No ESLint errors
- [ ] Code follows existing patterns
- [ ] JSDoc comments added for public methods
- [ ] README updated if needed
- [ ] CHANGELOG updated
- [ ] Feature flags properly configured
- [ ] Backward compatibility maintained
- [ ] No console.log statements (use logger)

---

## Getting Help

### Documentation

- [Phase 1 Execution Plan](./PHASE_1_EXECUTION_PLAN.md)
- [Architecture Documentation](./PHASE_1_ARCHITECTURE.md)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)

### Team Communication

- **Daily Standup:** 9:00 AM (15 minutes)
- **Code Review:** Within 24 hours
- **Slack Channel:** #phase1-refactoring
- **Pair Programming:** Schedule as needed

### Escalation

- **Blocker:** Notify team immediately in Slack
- **Architecture Question:** Schedule 30-min discussion
- **Test Failure:** Debug for 30 min, then ask for help

---

## Success Metrics

### Week 1 Goals

- ✅ Test infrastructure set up
- ✅ All 5 schemas defined
- ✅ Schema tests passing
- ✅ ServiceContainer implemented
- ✅ Feature flags working

### Daily Metrics

- **Tests Written:** Target 10-15 per day
- **Code Coverage:** Increase by 5% per day
- **Build Time:** Keep under 5 minutes
- **Test Execution:** Keep under 30 seconds

---

## Next Steps

After completing Week 1:

1. **Week 2:** Implement remaining services
2. **Week 3:** Refactor controller and integration tests
3. **Week 4:** Deployment and rollout

**Good luck! 🚀**

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-07  
**Maintained By:** OrchestratorAgent
