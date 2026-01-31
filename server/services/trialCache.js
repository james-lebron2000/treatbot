const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getRedisClient, isRedisEnabled } = require('../config/redis');

const CACHE_KEY = 'clinicalTrials:data:v1';
const CACHE_KEY_NORMALIZED = 'clinicalTrials:data:normalized:v1';
const TTL_SECONDS = Number(process.env.TRIALS_CACHE_TTL || 3600);
const IN_MEMORY_TTL_MS = Number(process.env.TRIALS_INMEMORY_TTL_MS || 5 * 60 * 1000);

function isInMemoryFresh(loadedAt) {
  if (!loadedAt) return false;
  if (!Number.isFinite(IN_MEMORY_TTL_MS) || IN_MEMORY_TTL_MS <= 0) return true;
  const age = Date.now() - new Date(loadedAt).getTime();
  return age >= 0 && age <= IN_MEMORY_TTL_MS;
}
function resolveDefaultTrialsPath() {
  if (process.env.TRIALS_JSON_PATH) {
    return path.resolve(process.cwd(), process.env.TRIALS_JSON_PATH);
  }

  const candidateDataRoots = [
    // Typical: run from repo root (or container WORKDIR=/app)
    path.join(process.cwd(), 'data'),
    // If started from ./server, allow ../data
    path.join(process.cwd(), '..', 'data'),
    // Repo layout fallback: <root>/server/services -> <root>/data
    path.join(__dirname, '..', '..', 'data'),
    // Container layout fallback: /app/services -> /app/data
    path.join(__dirname, '..', 'data')
  ].map((root) => path.normalize(root));

  const seen = new Set();
  const roots = candidateDataRoots.filter((root) => {
    if (seen.has(root)) return false;
    seen.add(root);
    return true;
  });

  for (const root of roots) {
    const enriched = path.join(root, 'trials_structured_enriched.json');
    if (fsSync.existsSync(enriched)) return enriched;
  }

  for (const root of roots) {
    const fallback = path.join(root, 'trials_structured.json');
    if (fsSync.existsSync(fallback)) return fallback;
  }

  // Default to the first candidate so errors have a stable path.
  return path.join(roots[0], 'trials_structured.json');
}

const DEFAULT_TRIALS_PATH = resolveDefaultTrialsPath();

let inMemoryTrials = null;
let inMemoryLoadedAt = null;
let normalizedTrialsCache = null;
let normalizedTrialsLoadedAt = null;

function getClient() {
  const client = getRedisClient();
  return client && isRedisEnabled() ? client : null;
}

async function readTrialsFromDisk() {
  const fileContent = await fs.readFile(DEFAULT_TRIALS_PATH, 'utf8');
  return JSON.parse(fileContent);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value)
    .split(/\r?\n|；|;||\u2028|\u2029/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) return [];
  return String(value)
    .replace(/\r\n/g, '\n')
    .split(/\n|；|;|。|\u3002/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPlaces(value) {
  if (!value) return [];
  return String(value)
    .split(/[,，、;；/\\|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function mapStatus(rawStatus) {
  const status = String(rawStatus || '').trim();

  // 优先级1：显式状态映射
  if (/招募中|正在招募|Recruiting|招募|Enrolling/i.test(status)) return 'recruiting';
  if (/进行中|Active|随访|跟进|Follow/i.test(status)) return 'active';
  if (/已完成|Completed|结束|终止完成/i.test(status)) return 'completed';
  if (/暂停|Suspended|终止|撤回|Withdrawn|停止/i.test(status)) return 'suspended';

  // 默认：未知状态视为可招募（避免过度过滤真实试验数据）
  return 'recruiting';
}

function mapPhase(rawPhase) {
  if (rawPhase === null || rawPhase === undefined) return undefined;
  if (typeof rawPhase === 'number') {
    const phaseNumber = Math.round(rawPhase);
    const romanMap = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
    return romanMap[phaseNumber]
      ? `Phase ${romanMap[phaseNumber]}`
      : `Phase ${phaseNumber}`;
  }
  const phaseText = String(rawPhase).trim();
  if (/^[0-9]+$/.test(phaseText)) {
    return mapPhase(Number(phaseText));
  }
  if (/I|II|III|IV/.test(phaseText)) {
    return phaseText.replace(/期$/, '').replace(/阶段$/, '').trim();
  }
  return phaseText || undefined;
}

function deriveGender(inclusionText = '') {
  const text = inclusionText;
  if (/仅限男性|男性患者/.test(text) && !/女性/.test(text)) {
    return 'male';
  }
  if (/仅限女性|女性患者|育龄女性/.test(text) && !/男性/.test(text)) {
    return 'female';
  }
  return 'both';
}

function extractAgeRange(structuredEligibility = {}) {
  const ageEntries = (structuredEligibility.inclusion || []).filter((entry) =>
    entry && typeof entry === 'object' && (entry.intent === 'age' || entry.tags?.includes?.('age'))
  );
  if (!ageEntries.length) {
    return null;
  }
  let min = null;
  let max = null;
  ageEntries.forEach((entry) => {
    const numeric = entry.numeric || {};
    if (numeric.min !== undefined && numeric.min !== null) {
      min = min === null ? Number(numeric.min) : Math.max(min, Number(numeric.min));
    }
    if (numeric.max !== undefined && numeric.max !== null) {
      max = max === null ? Number(numeric.max) : Math.min(max, Number(numeric.max));
    }
  });
  if (min === null && max === null) {
    return null;
  }
  return {
    min: min !== null ? Number(min) : undefined,
    max: max !== null ? Number(max) : undefined
  };
}

function normalizeTrial(raw) {
  const trialId = raw.项目编码 || raw.项目cde || raw.trialId || raw.id || '';
  const title = raw.项目名称 || raw.title || trialId;
  const inclusionList = parseList(raw.inclusion_list) || parseList(raw.入组条件);
  const exclusionList = parseList(raw.exclusion_list) || parseList(raw.排除条件);
  const structuredEligibility = raw.structuredEligibility || { inclusion: [], exclusion: [] };
  const primaryCondition = Array.isArray(raw.diseaseTokens) && raw.diseaseTokens.length
    ? raw.diseaseTokens[0]
    : (raw.疾病三级标签 || raw.疾病二级标签 || raw.疾病一级标签 || '').split(',')[0];
  const inclusionTextCombined = inclusionList.join(' ');
  const gender = deriveGender(inclusionTextCombined);
  const ageRange = extractAgeRange(structuredEligibility);

  const provinceRaw = raw.研究中心所在省份 || raw.province || raw.省份 || '';
  const cityRaw = raw.研究中心所在城市 || raw.city || raw.城市 || '';
  const provinces = splitPlaces(provinceRaw);
  const cities = splitPlaces(cityRaw);
  const province = provinces[0] || '';
  const city = cities[0] || '';
  const location = city || province || raw.location || '';

  const normalized = {
    trialId,
    title,
    condition: primaryCondition || '',
    phase: mapPhase(raw.分期试验阶段 || raw.phase),
    location,
    province: province || undefined,
    city: city || undefined,
    provinces: provinces.length ? provinces : undefined,
    cities: cities.length ? cities : undefined,
    status: mapStatus(raw.项目状态 || raw.status),
    sponsor: raw.申办方 || raw.sponsor || undefined,
    inclusionCriteria: inclusionList,
    exclusionCriteria: exclusionList,
    targetMutations: Array.isArray(raw.靶点) ? raw.靶点 : (Array.isArray(raw.targetMutations) ? raw.targetMutations : []),
    ageRange: ageRange || undefined,
    gender,
    structuredEligibility,
    diseaseTags: raw.疾病三级标签 || '',
    therapies: Array.isArray(raw.therapies) ? raw.therapies : [],
    contactInfo: undefined,
    estimatedEnrollment: raw.入组人数 || undefined
  };

  return normalized;
}

function buildTrialsCsv(trials = []) {
  const escape = (value) => {
    if (value === null || value === undefined) return '""';
    if (Array.isArray(value)) {
      return escape(value.join('|'));
    }
    const text = String(value).replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return `"${text}"`;
  };

  const lines = trials.map((trial) => {
    const ageRange = trial.ageRange
      ? [
          trial.ageRange.min != null ? trial.ageRange.min : '',
          trial.ageRange.max != null ? trial.ageRange.max : ''
        ].filter((item) => item !== '').join('-')
      : '';
    return [
      escape(trial.trialId),
      escape(trial.title),
      escape(trial.condition),
      escape(trial.phase || ''),
      escape(trial.targetMutations && trial.targetMutations.length ? trial.targetMutations.join('|') : ''),
      escape(ageRange),
      escape(trial.gender || 'both'),
      escape((trial.inclusionCriteria || []).join('; ')),
      escape((trial.exclusionCriteria || []).join('; '))
    ].join(',');
  });

  return lines.join('\n');
}

async function loadTrials() {
  if (inMemoryTrials && isInMemoryFresh(inMemoryLoadedAt)) {
    return inMemoryTrials;
  }
  if (inMemoryTrials && !isInMemoryFresh(inMemoryLoadedAt)) {
    inMemoryTrials = null;
    inMemoryLoadedAt = null;
  }

  const client = getClient();
  if (client) {
    try {
      const cached = await client.get(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        inMemoryTrials = parsed;
        inMemoryLoadedAt = new Date();
        return parsed;
      }
    } catch (err) {
      logger.warn({ err }, '读取 Redis 临床试验缓存失败，回退到文件');
    }
  }

  const trials = await readTrialsFromDisk();
  inMemoryTrials = trials;
  inMemoryLoadedAt = new Date();
  normalizedTrialsCache = null;
  normalizedTrialsLoadedAt = null;

  if (client) {
    try {
      await client.set(CACHE_KEY, JSON.stringify(trials), 'EX', TTL_SECONDS);
    } catch (err) {
      logger.warn({ err }, '写入 Redis 临床试验缓存失败');
    }
  }

  return trials;
}

async function refreshTrials() {
  inMemoryTrials = null;
  inMemoryLoadedAt = null;
  normalizedTrialsCache = null;
  normalizedTrialsLoadedAt = null;
  const client = getClient();
  if (client) {
    await client.del(CACHE_KEY);
    await client.del(CACHE_KEY_NORMALIZED);
  }
  return loadTrials();
}

async function loadNormalizedTrials() {
  if (normalizedTrialsCache && isInMemoryFresh(normalizedTrialsLoadedAt)) {
    return normalizedTrialsCache;
  }
  if (normalizedTrialsCache && !isInMemoryFresh(normalizedTrialsLoadedAt)) {
    normalizedTrialsCache = null;
    normalizedTrialsLoadedAt = null;
  }

  const rawTrials = await loadTrials();
  const client = getClient();

  if (client) {
    try {
      const cached = await client.get(CACHE_KEY_NORMALIZED);
      if (cached) {
        const parsed = JSON.parse(cached);
        normalizedTrialsCache = parsed;
        normalizedTrialsLoadedAt = new Date();
        return parsed;
      }
    } catch (err) {
      logger.warn({ err }, '读取 Redis 归一化临床试验缓存失败，回退到内存');
    }
  }

  const normalized = rawTrials.map((trial) => normalizeTrial(trial));
  normalizedTrialsCache = normalized;
  normalizedTrialsLoadedAt = new Date();

  if (client) {
    try {
      await client.set(CACHE_KEY_NORMALIZED, JSON.stringify(normalized), 'EX', TTL_SECONDS);
    } catch (err) {
      logger.warn({ err }, '写入 Redis 归一化临床试验缓存失败');
    }
  }

  return normalized;
}

function getCacheMetadata() {
  return {
    inMemoryLoadedAt,
    sourcePath: DEFAULT_TRIALS_PATH,
    ttlSeconds: TTL_SECONDS,
    normalizedLoadedAt: normalizedTrialsLoadedAt
  };
}

module.exports = {
  loadTrials,
  refreshTrials,
  loadNormalizedTrials,
  buildTrialsCsv,
  getCacheMetadata
};
