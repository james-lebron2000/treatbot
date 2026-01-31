/**
 * Jest Configuration
 * Test framework configuration for Phase 1 refactoring
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Coverage configuration
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server/services/**/*.js',
    'server/controllers/**/*.js',
    'server/models/**/*.js',
    'server/utils/**/*.js',
    '!**/*.test.js',
    '!**/__tests__/**',
    '!**/node_modules/**',
    '!**/coverage/**'
  ],

  // Coverage thresholds
  coverageThresholds: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60
    },
    // Critical path: 90% coverage
    './server/services/trialMatchingEngine.js': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './server/services/matching/TrialMatchOrchestrator.js': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/server/test/setup.js'],

  // Test match patterns
  testMatch: [
    '**/test/**/*.test.js',
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Test path ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/dist/'
  ],

  // Module paths
  moduleDirectories: ['node_modules', 'server'],

  // Verbose output
  verbose: true,

  // Detect open handles
  detectOpenHandles: true,

  // Force exit after tests complete
  forceExit: true,

  // Test timeout (30 seconds)
  testTimeout: 30000,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],

  // Transform configuration (if using TypeScript in future)
  transform: {},

  // Global setup/teardown
  // globalSetup: undefined,
  // globalTeardown: undefined,

  // Reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './coverage',
        outputName: 'junit.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true
      }
    ]
  ]
};
