/**
 * Feature Flag Service
 * Manages feature flags for safe rollout and rollback
 */

const logger = require('../../utils/logger');

class FeatureFlagService {
  constructor() {
    this.flags = new Map();
    this.loadFlags();
  }

  /**
   * Load flags from environment variables
   */
  loadFlags() {
    const flagPrefix = 'FEATURE_';
    Object.keys(process.env).forEach(key => {
      if (key.startsWith(flagPrefix)) {
        const flagName = key.substring(flagPrefix.length).toLowerCase();
        this.flags.set(flagName, process.env[key] === 'true');
      }
    });
    
    this.setDefaultFlags();
    logger.info({ flags: Array.from(this.flags.entries()) }, 'Feature flags loaded');
  }

  /**
   * Set default flag values
   */
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
    
    Object.entries(defaults).forEach(([key, value]) => {
      if (!this.flags.has(key)) {
        this.flags.set(key, value);
      }
    });
  }

  /**
   * Check if a feature flag is enabled
   * @param {string} flagName - Name of the flag
   * @param {Object} context - Context for evaluation (userId, etc.)
   * @returns {boolean} Whether the flag is enabled
   */
  isEnabled(flagName, context = {}) {
    // Check percentage rollout
    if (this.hasPercentageRollout(flagName)) {
      return this.checkPercentageRollout(flagName, context);
    }
    
    // Default flag value
    return this.flags.get(flagName) || false;
  }

  /**
   * Check if flag has percentage rollout configured
   */
  hasPercentageRollout(flagName) {
    const percentage = process.env[`FEATURE_${flagName.toUpperCase()}_PERCENTAGE`];
    return percentage !== undefined && percentage !== '';
  }

  /**
   * Check if user falls within percentage rollout
   */
  checkPercentageRollout(flagName, context) {
    const percentage = parseInt(process.env[`FEATURE_${flagName.toUpperCase()}_PERCENTAGE`], 10);
    if (isNaN(percentage) || !context.userId) return false;
    
    // Deterministic hash-based rollout
    const hash = this.hashUserId(context.userId);
    return (hash % 100) < percentage;
  }

  /**
   * Simple hash function for deterministic percentage rollout
   */
  hashUserId(userId) {
    const str = userId.toString();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get all flag values (for debugging)
   */
  getAllFlags() {
    return Object.fromEntries(this.flags);
  }

  /**
   * Manually set a flag (for testing)
   */
  setFlag(flagName, value) {
    this.flags.set(flagName, value);
  }

  /**
   * Reset flags to defaults (for testing)
   */
  reset() {
    this.flags.clear();
    this.loadFlags();
  }
}

// Export singleton instance
module.exports = new FeatureFlagService();
