const { getRedisClient, isRedisEnabled } = require('../config/redis');

const inMemoryStore = new Map();

function getClient() {
  const client = getRedisClient();
  return client && isRedisEnabled() ? client : null;
}

function buildValue(value) {
  return JSON.stringify({ value, storedAt: Date.now() });
}

async function get(key) {
  const client = getClient();
  if (client) {
    const payload = await client.get(key);
    if (payload) {
      return JSON.parse(payload).value;
    }
    return null;
  }

  const entry = inMemoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    inMemoryStore.delete(key);
    return null;
  }
  return entry.value;
}

async function set(key, value, ttlSeconds = 300) {
  const client = getClient();
  if (client) {
    if (ttlSeconds) {
      await client.set(key, buildValue(value), 'EX', ttlSeconds);
    } else {
      await client.set(key, buildValue(value));
    }
    return;
  }

  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  inMemoryStore.set(key, { value, expiresAt });
}

async function del(key) {
  const client = getClient();
  if (client) {
    await client.del(key);
  }
  inMemoryStore.delete(key);
}

async function flushByPrefix(prefix) {
  const client = getClient();
  if (client) {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) {
      await client.del(keys);
    }
  }
  for (const key of Array.from(inMemoryStore.keys())) {
    if (key.startsWith(prefix)) {
      inMemoryStore.delete(key);
    }
  }
}

module.exports = {
  get,
  set,
  del,
  flushByPrefix
};
