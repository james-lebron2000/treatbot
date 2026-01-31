const BaseMatchStrategy = require('./BaseMatchStrategy');

class HybridMatchStrategy extends BaseMatchStrategy {
  async execute(patientData, trials, options = {}) {
    const { hybridMatchingService } = this.deps;

    const hybridResult = await hybridMatchingService.match({
      patientData,
      trials,
      options: options.hybridOptions || {
        llmReview: { enabled: false }
      }
    });

    const matches = (hybridResult.matches || []).map((match) => ({
      trial_id: match.trial_id,
      trial_title: match.trial_title || match.trialTitle,
      match_score: match.match_score || match.matchScore,
      inclusion_checks: match.inclusion_checks || [],
      exclusion_checks: match.exclusion_checks || [],
      summary: match.summary || {
        inclusion_met: [],
        exclusion_triggered: [],
        uncertain: []
      },
      rank_reason: match.rank_reason || match.overallSummary,
      trial_metadata: match.trialMetadata || match.trial_metadata,
      dataQualityWarning: match.dataQualityWarning || false,
      missingFields: match.missingFields || []
    }));

    return {
      provider: 'hybrid-v2.0',
      metadata: hybridResult.metadata || {},
      matches
    };
  }
}

module.exports = HybridMatchStrategy;

