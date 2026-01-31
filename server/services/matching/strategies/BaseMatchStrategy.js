class BaseMatchStrategy {
  constructor(deps = {}) {
    this.deps = deps;
  }

  // eslint-disable-next-line class-methods-use-this
  async execute() {
    throw new Error('Not implemented');
  }
}

module.exports = BaseMatchStrategy;

