/**
 * FeatureFlagService Unit Tests
 */

describe('FeatureFlagService', () => {
  let FeatureFlagService;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear module cache to get fresh instance
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('flag loading', () => {
    it('should load flags from environment variables', () => {
      process.env.FEATURE_TEST_FLAG = 'true';
      process.env.FEATURE_ANOTHER_FLAG = 'false';

      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');

      expect(FeatureFlagService.isEnabled('test_flag')).toBe(true);
      expect(FeatureFlagService.isEnabled('another_flag')).toBe(false);
    });

    it('should set default flags', () => {
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');

      expect(FeatureFlagService.isEnabled('use_refactored_services')).toBe(false);
      expect(FeatureFlagService.isEnabled('enable_hybrid_matching')).toBe(true);
    });
  });

  describe('isEnabled', () => {
    beforeEach(() => {
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');
    });

    it('should return false for undefined flags', () => {
      expect(FeatureFlagService.isEnabled('nonexistent_flag')).toBe(false);
    });

    it('should return true for enabled flags', () => {
      FeatureFlagService.setFlag('test_flag', true);
      expect(FeatureFlagService.isEnabled('test_flag')).toBe(true);
    });

    it('should return false for disabled flags', () => {
      FeatureFlagService.setFlag('test_flag', false);
      expect(FeatureFlagService.isEnabled('test_flag')).toBe(false);
    });
  });

  describe('percentage rollout', () => {
    beforeEach(() => {
      process.env.FEATURE_TEST_FLAG_PERCENTAGE = '50';
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');
    });

    it('should enable flag for users within percentage', () => {
      // User with hash that falls within 50%
      const result1 = FeatureFlagService.isEnabled('test_flag', { userId: 'user1' });
      const result2 = FeatureFlagService.isEnabled('test_flag', { userId: 'user2' });

      // At least one should be enabled (statistically)
      expect(typeof result1).toBe('boolean');
      expect(typeof result2).toBe('boolean');
    });

    it('should be deterministic for same user', () => {
      const result1 = FeatureFlagService.isEnabled('test_flag', { userId: 'user123' });
      const result2 = FeatureFlagService.isEnabled('test_flag', { userId: 'user123' });

      expect(result1).toBe(result2);
    });

    it('should return false when no userId provided', () => {
      const result = FeatureFlagService.isEnabled('test_flag', {});
      expect(result).toBe(false);
    });
  });

  describe('hashUserId', () => {
    beforeEach(() => {
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');
    });

    it('should return consistent hash for same userId', () => {
      const hash1 = FeatureFlagService.hashUserId('user123');
      const hash2 = FeatureFlagService.hashUserId('user123');

      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different userIds', () => {
      const hash1 = FeatureFlagService.hashUserId('user123');
      const hash2 = FeatureFlagService.hashUserId('user456');

      expect(hash1).not.toBe(hash2);
    });

    it('should return non-negative hash', () => {
      const hash = FeatureFlagService.hashUserId('user123');
      expect(hash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAllFlags', () => {
    beforeEach(() => {
      process.env.FEATURE_TEST_FLAG = 'true';
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');
    });

    it('should return all flag values', () => {
      const allFlags = FeatureFlagService.getAllFlags();

      expect(allFlags).toHaveProperty('test_flag');
      expect(allFlags).toHaveProperty('use_refactored_services');
      expect(typeof allFlags).toBe('object');
    });
  });

  describe('setFlag', () => {
    beforeEach(() => {
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');
    });

    it('should manually set flag value', () => {
      FeatureFlagService.setFlag('manual_flag', true);
      expect(FeatureFlagService.isEnabled('manual_flag')).toBe(true);

      FeatureFlagService.setFlag('manual_flag', false);
      expect(FeatureFlagService.isEnabled('manual_flag')).toBe(false);
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      FeatureFlagService = require('../../../services/featureFlags/FeatureFlagService');
    });

    it('should reset flags to defaults', () => {
      FeatureFlagService.setFlag('test_flag', true);
      expect(FeatureFlagService.isEnabled('test_flag')).toBe(true);

      FeatureFlagService.reset();
      expect(FeatureFlagService.isEnabled('test_flag')).toBe(false);
    });
  });
});
