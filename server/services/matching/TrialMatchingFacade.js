const RuleBasedMatchStrategy = require('./strategies/RuleBasedMatchStrategy');
const HybridMatchStrategy = require('./strategies/HybridMatchStrategy');

class TrialMatchingFacade {
  constructor(deps = {}) {
    this.deps = deps;
    this.strategies = {
      'rule-based': new RuleBasedMatchStrategy(deps),
      hybrid: new HybridMatchStrategy(deps)
    };
  }

  async match({ patientData, trials, strategy = 'hybrid', options = {} } = {}) {
    const key = strategy === 'rule-based' || strategy === 'hybrid' ? strategy : 'hybrid';
    const impl = this.strategies[key] || this.strategies.hybrid;
    return impl.execute(patientData, trials, options);
  }
}

module.exports = TrialMatchingFacade;

