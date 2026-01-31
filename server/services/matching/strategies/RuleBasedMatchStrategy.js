const BaseMatchStrategy = require('./BaseMatchStrategy');
const { isClinicalArchiveFormat } = require('../../../utils/medicalHelpers');

class RuleBasedMatchStrategy extends BaseMatchStrategy {
  async execute(patientData, trials, options = {}) {
    const {
      trialMatchingEngine,
      enhancedTrialMatcher,
      convertEngineMatchesToEnhanced,
      attachMetadataToMatches,
      getTrialLookup
    } = this.deps;

    const { patientId = 'adhoc' } = options;
    const trialLookup = getTrialLookup ? getTrialLookup(trials) : new Map();

    if (isClinicalArchiveFormat(patientData)) {
      const matches = enhancedTrialMatcher.matchTrialsWithArchive(patientData, trials);
      return {
        provider: 'rule-engine-v2',
        metadata: {},
        matches: attachMetadataToMatches ? attachMetadataToMatches(matches, trialLookup) : matches
      };
    }

    const engineResults = await trialMatchingEngine.matchPatient(patientData, patientId);
    const converted = convertEngineMatchesToEnhanced(engineResults, trialLookup);
    return {
      provider: 'rule-engine-v1',
      metadata: {},
      matches: attachMetadataToMatches ? attachMetadataToMatches(converted, trialLookup) : converted
    };
  }
}

module.exports = RuleBasedMatchStrategy;

