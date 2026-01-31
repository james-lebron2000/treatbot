/**
 * Jest Test Setup
 * Configures test environment, MongoDB Memory Server, and mocks
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

/**
 * Setup before all tests
 */
beforeAll(async () => {
  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log('✓ MongoDB Memory Server started');
});

/**
 * Cleanup after all tests
 */
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  console.log('✓ MongoDB Memory Server stopped');
});

/**
 * Clear all collections after each test
 */
afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Mock external services
jest.mock('../services/ocrService');
jest.mock('../services/llmIntegrationService');
jest.mock('../services/trialMatchingService');

// Test utilities
const mongoose_types = mongoose.Types;

const testUtils = {
  /**
   * Create a mock user for testing
   */
  createMockUser: (overrides = {}) => ({
    _id: new mongoose_types.ObjectId(),
    email: 'test@example.com',
    password: 'hashedpassword123',
    name: 'Test User',
    createdAt: new Date(),
    ...overrides
  }),

  /**
   * Create a mock medical record
   */
  createMockRecord: (userId, overrides = {}) => ({
    _id: new mongoose_types.ObjectId(),
    userId: userId || new mongoose_types.ObjectId(),
    extractedText: 'Test medical text',
    structuredData: {
      diagnosis: 'Test diagnosis',
      age: 65,
      gender: 'male'
    },
    uploadDate: new Date(),
    ...overrides
  }),

  /**
   * Create a mock clinical trial
   */
  createMockTrial: (overrides = {}) => ({
    项目编码: 'TEST001',
    项目名称: 'Test Clinical Trial',
    status: 'recruiting',
    phase: 'III',
    condition: 'Test Condition',
    ...overrides
  }),

  /**
   * Create a mock patient
   */
  createMockPatient: (userId, overrides = {}) => ({
    _id: new mongoose_types.ObjectId(),
    userId: userId || new mongoose_types.ObjectId(),
    patientId: 'P001',
    name: 'Test Patient',
    gender: 'male',
    createdAt: new Date(),
    ...overrides
  }),

  /**
   * Create a mock OCR result
   */
  createMockOCRResult: (overrides = {}) => ({
    success: true,
    results: [
      {
        content: 'Test OCR content',
        confidence: 95
      }
    ],
    averageConfidence: 95,
    processingTime: 1000,
    totalPages: 1,
    provider: 'mock-ocr',
    isFallback: false,
    ...overrides
  }),

  /**
   * Create a mock LLM integration result
   */
  createMockLLMResult: (overrides = {}) => ({
    success: true,
    correctedText: 'Corrected medical text',
    structuredData: {
      patientProfile: {
        age: { value: 65 },
        gender: { value: '男' }
      },
      clinicalInformation: {
        diagnosis: { primary: 'Test diagnosis' }
      },
      treatmentHistory: []
    },
    clinicalArchive: null,
    timeline: 'Test timeline',
    metadata: {
      provider: 'mock-llm',
      model: 'test-model',
      processingTime: 2000
    },
    ...overrides
  })
};

module.exports = testUtils;
