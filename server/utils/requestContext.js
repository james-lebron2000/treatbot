const { AsyncLocalStorage } = require('node:async_hooks');

// Request-scoped context (traceId/userId/etc.) propagated across async boundaries.
// This lets us inject traceId into all logs without manually threading it everywhere.
const storage = new AsyncLocalStorage();

function run(initialContext, fn) {
  const seed = initialContext && typeof initialContext === 'object' ? { ...initialContext } : {};
  return storage.run(seed, fn);
}

function get() {
  return storage.getStore() || null;
}

function merge(patch) {
  const store = storage.getStore();
  if (!store) return;
  if (!patch || typeof patch !== 'object') return;
  Object.assign(store, patch);
}

module.exports = {
  run,
  get,
  merge,
};

