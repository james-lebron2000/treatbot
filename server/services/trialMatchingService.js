const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');
const cacheService = require('./cache');
const { normaliseRecordForMatching } = require('../utils/patientDataNormalizer');
const { sanitizePatientDataForLLM } = require('../utils/llmPrivacy');
const { validateMatchResults } = require('../utils/matchResultValidator');
const {
  recordLLMMatchRequest,
  recordLLMMatchTokens,
  recordLLMMatchParseFailure
} = require('../monitoring/metrics');

const MATCH_PROMPT_PATH = path.join(__dirname, '..', '..', 'docs', 'prompts', 'prompt_match_clinical_trails.md');
const LLM_MATCH_MAX_RESULTS = Number(process.env.LLM_MATCH_MAX_RESULTS || 15);

const ALLOWED_RESULTS = new Set(['满足', '不满足', '可能不满足', '不确定']);

function toCleanString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined)
      .map((item) => toCleanString(item, ''))
      .filter((item) => item)
      .join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return fallback;
    }
  }
  return fallback;
}

function coerceArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function normalizeCheck(entry = {}) {
  const criterion = toCleanString(entry.criterion || entry.criteria || entry.requirement, '未提供') || '未提供';
  const patientValue = toCleanString(entry.patient_value || entry.patientValue || entry.value || '', '未提供');
  const rawResult = toCleanString(entry.result || entry.status || '', '不确定');
  const result = ALLOWED_RESULTS.has(rawResult) ? rawResult : '不确定';
  return {
    criterion,
    patient_value: patientValue || '未提供',
    result
  };
}

function normalizeSummary(summary = {}) {
  const inclusionMet = coerceArray(summary.inclusion_met || summary.inclusionMet)
    .map((item) => toCleanString(item, ''))
    .filter(Boolean);
  const exclusionTriggered = coerceArray(summary.exclusion_triggered || summary.exclusionTriggered)
    .map((item) => toCleanString(item, ''))
    .filter(Boolean);
  const uncertain = coerceArray(summary.uncertain)
    .map((item) => toCleanString(item, ''))
    .filter(Boolean);

  return {
    inclusion_met: Array.from(new Set(inclusionMet)),
    exclusion_triggered: Array.from(new Set(exclusionTriggered)),
    uncertain: Array.from(new Set(uncertain))
  };
}

function normalizeMatch(entry = {}) {
  const trialId = toCleanString(entry.trial_id || entry.trialId || entry.id || entry.trial?.trialId, '');
  const trialTitle = toCleanString(entry.trial_title || entry.title || entry.trial?.title, trialId);
  const matchScoreRaw = entry.match_score ?? entry.matchScore ?? entry.score ?? 0;
  const matchScore = Number.isFinite(Number(matchScoreRaw)) ? Math.max(0, Math.min(100, Math.round(Number(matchScoreRaw)))) : 0;

  const inclusionChecks = coerceArray(entry.inclusion_checks || entry.inclusions)
    .map(normalizeCheck);
  const exclusionChecks = coerceArray(entry.exclusion_checks || entry.exclusions)
    .map(normalizeCheck);

  const summary = normalizeSummary(entry.summary || {});
  const rankReason = toCleanString(entry.rank_reason || entry.overallSummary || entry.reason, '');

  if (!trialId) {
    return null;
  }

  return {
    trial_id: trialId,
    trial_title: trialTitle || trialId,
    match_score: matchScore,
    inclusion_checks: inclusionChecks,
    exclusion_checks: exclusionChecks,
    summary,
    rank_reason: rankReason || undefined
  };
}

function normalizeMatches(raw) {
  const candidates = coerceArray(raw?.matches || raw);
  const normalized = candidates
    .map(normalizeMatch)
    .filter(Boolean)
    .sort((a, b) => b.match_score - a.match_score);
  const limit = Number.isFinite(LLM_MATCH_MAX_RESULTS) ? Math.max(1, Math.min(100, LLM_MATCH_MAX_RESULTS)) : 15;
  return normalized.slice(0, limit);
}

function fingerprintPatient(patientData) {
  try {
    const normalized = normaliseRecordForMatching({ structuredData: patientData });
    if (!normalized) {
      return { hash: null, warnings: [], canonical: null };
    }
    const canonical = normalized.canonical || {};
    const digestSource = {
      age: canonical.demographics?.age ?? null,
      gender: canonical.demographics?.gender ?? null,
      diagnosis: canonical.diagnosis?.primary ?? '',
      stage: canonical.diagnosis?.stage ?? '',
      therapyLines: canonical.treatments?.previousLines ?? null,
      biomarkers: canonical.biomarkers ? Object.entries(canonical.biomarkers).slice(0, 8) : []
    };
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(digestSource))
      .digest('hex');
    return { hash, warnings: normalized.warnings || [], canonical };
  } catch (err) {
    logger.warn({ err }, 'Failed to fingerprint patient data for LLM matching');
    return { hash: null, warnings: [], canonical: null };
  }
}

function buildCohortHash(csvText = '') {
  return crypto.createHash('sha1').update(csvText).digest('hex').slice(0, 16);
}

function buildLLMCacheKey({ patientHash, cohortHash }) {
  if (!patientHash || !cohortHash) return null;
  return `llm:cohort:${cohortHash}:patient:${patientHash}`;
}

function shouldBypassLLM({ baseline, warnings = [] } = {}) {
  if (!baseline) return false;
  if (Array.isArray(warnings) && warnings.length > 0) {
    return false;
  }
  const { topScore = 0, matchCount = 0 } = baseline;
  return matchCount >= 3 && topScore >= 75;
}

class TrialMatchingService {
  constructor() {
    this.apiConfig = config.moonshot;
    this.openai = this.apiConfig.apiKey
      ? new OpenAI({ apiKey: this.apiConfig.apiKey, baseURL: this.apiConfig.baseURL })
      : null;
  }

  loadPrompt() {
    try {
      return fs.readFileSync(MATCH_PROMPT_PATH, 'utf8');
    } catch (e) {
      logger.warn({ err: e }, 'Prompt 文件缺失或读取失败，使用默认匹配提示');
      return '你是一个临床试验匹配引擎。根据患者数据和试验标准进行匹配，并输出JSON数组。';
    }
  }

  async matchWithLLM({ patientData, csvText, patientId, baseline } = {}) {
    const started = Date.now();
    const { hash: patientHash, warnings } = fingerprintPatient(patientData);
    const cohortHash = buildCohortHash(csvText);
    const cacheKey = buildLLMCacheKey({ patientHash, cohortHash });

    if (!this.openai) {
      logger.warn({ patientId }, 'LLM 配置缺失，匹配请求降级');
      recordLLMMatchRequest('disabled');
      return {
        success: false,
        matches: [],
        metadata: {
          provider: 'moonshot',
          model: null,
          processingTime: 0,
          totalTokens: 0,
          patientId,
          warnings,
          reason: 'disabled'
        }
      };
    }

    if (shouldBypassLLM({ baseline, warnings })) {
      logger.info({ patientId, baseline }, '跳过 LLM 匹配：规则匹配结果充足');
      recordLLMMatchRequest('skipped');
      return {
        success: false,
        skipped: true,
        matches: [],
        metadata: {
          provider: 'moonshot',
          model: null,
          processingTime: 0,
          totalTokens: 0,
          patientId,
          warnings,
          baseline,
          reason: 'deterministic_sufficient'
        }
      };
    }

    if (cacheKey) {
      const cached = await cacheService.get(cacheKey);
      if (cached && Array.isArray(cached.matches) && cached.matches.length > 0) {
        logger.debug({ patientId, cacheKey }, '使用缓存的 LLM 匹配结果');
        recordLLMMatchRequest('cached');
        return {
          success: true,
          cached: true,
          matches: cached.matches,
          metadata: {
            ...(cached.metadata || {}),
            cached: true,
            cachedAt: cached.cachedAt,
            patientId,
            warnings,
            baseline
          }
        };
      }
    }

    const systemPrompt = this.loadPrompt();
    const maxResults = Number.isFinite(LLM_MATCH_MAX_RESULTS)
      ? Math.max(1, Math.min(100, Math.floor(LLM_MATCH_MAX_RESULTS)))
      : 15;
    const safePatientData = sanitizePatientDataForLLM(patientData);
    const userContent = [
      'PatientData JSON:',
      '```json',
      JSON.stringify(safePatientData, null, 2),
      '```',
      '',
      'TrialCriteria CSV (UTF-8):',
      '```csv',
      csvText,
      '```',
      '',
      `请根据上述数据，输出一个严格合法的 JSON 数组，按匹配度降序列出最多 ${maxResults} 项结果。`,
      '每个对象必须包含字段：',
      '{',
      '  "trial_id": string,',
      '  "trial_title": string,',
      '  "match_score": number (0-100),',
      '  "inclusion_checks": Array<{ criterion, patient_value, result }>,',
      '  "exclusion_checks": Array<{ criterion, patient_value, result }>,',
      '  "summary": { inclusion_met: string[], exclusion_triggered: string[], uncertain: string[] },',
      '  "rank_reason": string (可选)',
      '}',
      '字段 result 只允许 "满足"、"不满足"、"可能不满足"、"不确定"。不要输出除数组外的任何文字或代码块。'
    ].join('\n');

    try {
      const resp = await this.openai.chat.completions.create({
        model: 'kimi-k2-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.1,
        max_tokens: 3000
      });

      const content = resp.choices?.[0]?.message?.content || '';
      const usage = resp.usage || {};

      logger.debug({
        patientId,
        responseLength: content.length,
        totalTokens: usage.total_tokens || 0,
        processingTime: Date.now() - started
      }, 'LLM 匹配请求完成');

      let matches = [];
      try {
        const startIdx = content.indexOf('[');
        const endIdx = content.lastIndexOf(']');
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          const jsonText = content.slice(startIdx, endIdx + 1);
          matches = JSON.parse(jsonText);
        }
      } catch (parseError) {
        logger.error({ err: parseError, patientId }, 'LLM 匹配 JSON 解析失败');
        recordLLMMatchParseFailure('json_parse');
      }

      const normalized = normalizeMatches(matches);
      let validated;
      try {
        validated = validateMatchResults(normalized, 'llm-response');
      } catch (validationError) {
        logger.error({ err: validationError, patientId }, 'LLM 匹配结果验证失败');
        recordLLMMatchParseFailure('schema_validation');
        recordLLMMatchRequest('validation_failed');
        if (usage.total_tokens) {
          recordLLMMatchTokens('total', usage.total_tokens);
        }
        return {
          success: false,
          matches: [],
          metadata: {
            provider: 'moonshot',
            model: 'kimi-k2-turbo-preview',
            processingTime: Date.now() - started,
            totalTokens: usage.total_tokens || 0,
            patientId,
            warnings,
            baseline,
            error: validationError.message
          }
        };
      }

      if (usage.total_tokens) {
        recordLLMMatchTokens('total', usage.total_tokens);
      }

      const statusLabel = validated.length > 0 ? 'success' : 'empty';
      recordLLMMatchRequest(statusLabel);

      const result = {
        success: validated.length > 0,
        matches: validated,
        metadata: {
          provider: 'moonshot',
          model: 'kimi-k2-turbo-preview',
          processingTime: Date.now() - started,
          totalTokens: usage.total_tokens || 0,
          patientId,
          warnings,
          baseline
        }
      };

      if (cacheKey && validated.length > 0) {
        await cacheService.set(cacheKey, {
          matches: validated,
          metadata: result.metadata,
          cachedAt: new Date().toISOString()
        }, Number(process.env.LLM_MATCH_CACHE_TTL || 3600));
      }

      return result;
    } catch (error) {
      logger.error({ err: error, patientId }, 'LLM 匹配请求失败');
      recordLLMMatchRequest('error');
      return {
        success: false,
        matches: [],
        metadata: {
          provider: 'moonshot',
          model: 'kimi-k2-turbo-preview',
          processingTime: Date.now() - started,
          totalTokens: 0,
          patientId,
          warnings,
          baseline,
          error: error.message
        }
      };
    }
  }
}

module.exports = TrialMatchingService;
