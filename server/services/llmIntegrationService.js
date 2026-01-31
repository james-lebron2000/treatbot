const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');
const { prepareTextForLLM } = require('../utils/llmPrivacy');
const {
  createPatientArchive,
  ingestLLMStructuredData
} = require('../utils/patientArchive');

const PROMPT_FILE_PATH = path.join(__dirname, '..', '..', 'docs', 'prompts', 'prompt_integrate_info.md');

const DEFAULT_FIELD_PROMPTS = [
  {
    key: 'age',
    type: 'number',
    prompt: '提取患者的年龄（单位：岁）。只返回数字；若病历未提及年龄，请返回 null。'
  },
  {
    key: 'gender',
    type: 'string',
    prompt: '提取患者的性别。只允许输出 male、female 或 unknown；若无法确定，请返回 unknown。'
  },
  {
    key: 'primary_diagnosis',
    type: 'string',
    prompt: '提取患者的主要肿瘤诊断（例如“肺腺癌”、“肝细胞癌”）。若未提及，请返回 null。'
  },
  {
    key: 'pathology_type',
    type: 'string',
    prompt: '提取病理分型或组织学类型（例如“鳞癌”、“腺癌”、“HER2 阳性”）。若未提及，请返回 null。'
  },
  {
    key: 'staging_value',
    type: 'string',
    prompt: '提取最新的肿瘤分期（如 TNM、BCLC、CNLC、AJCC 等）。返回原文中的分期描述，若未提及请返回 null。'
  },
  {
    key: 'metastasis_sites',
    type: 'array',
    prompt: '列出病历文本中提到的肿瘤转移部位（如“骨”、“肺”、“脑”）。若无转移或未提及，请返回空数组。'
  },
  {
    key: 'ecog_score',
    type: 'number',
    prompt: '提取患者的 ECOG 体能状态评分（0-4）。若未提及，请返回 null。'
  },
  {
    key: 'viral_hepatitis.hbv_status',
    type: 'string',
    prompt: '提取乙肝状态（如“HBsAg 阳性”、“乙肝阴性”、“既往感染”）。若未提及，请返回 null。'
  },
  {
    key: 'viral_hepatitis.hcv_status',
    type: 'string',
    prompt: '提取丙肝状态（如“HCV 阴性”、“HCV RNA 阳性”）。若未提及，请返回 null。'
  }
];

const FIELD_SYSTEM_PROMPT = `你是一名临床病历信息结构化抽取助手。请从提供的中文或英文病历文本中抽取指定字段。输出 JSON 对象，包含以下键：
- value：字段的抽取结果；如果无法确定，请使用 null；
- confidence：取值为 high、medium、low，用于表示结果可信度；
- evidence：原文中支持结果的最重要片段，若无请留空字符串；
- reasoning：简要说明该结果的依据或判断过程，若无可留空。
除 JSON 外不要添加任何额外文字。`;

const ALLOWED_CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

function sanitizeJsonBlock(text = '') {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```/i, '');
  cleaned = cleaned.replace(/```$/i, '');
  return cleaned.trim();
}

function normalizeConfidenceLevel(confidence) {
  if (!confidence) return 'medium';
  const lower = String(confidence).trim().toLowerCase();
  if (ALLOWED_CONFIDENCE_LEVELS.includes(lower)) {
    return lower;
  }
  if (/高/.test(lower)) return 'high';
  if (/低/.test(lower)) return 'low';
  return 'medium';
}

function coerceFieldValue(fieldType, value) {
  if (value === undefined || value === null) return null;
  switch (fieldType) {
    case 'number': {
      if (typeof value === 'number' && !Number.isNaN(value)) return value;
      if (typeof value === 'string') {
        const match = value.match(/-?\d+(?:\.\d+)?/);
        if (!match) return null;
        const num = Number(match[0]);
        return Number.isNaN(num) ? null : num;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'object' && value.value !== undefined) {
        return coerceFieldValue('number', value.value);
      }
      return Number.isFinite(value) ? Number(value) : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (/^(true|yes|是|阳性|positive)$/i.test(normalized)) return true;
        if (/^(false|no|否|阴性|negative)$/i.test(normalized)) return false;
      }
      return null;
    }
    case 'array': {
      if (Array.isArray(value)) {
        return value.map((item) => (typeof item === 'string' ? item.trim() : item)).filter(Boolean);
      }
      if (typeof value === 'string') {
        return value
          .split(/[,，;；\s]+/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    }
    default:
      return typeof value === 'string' ? value.trim() : value;
  }
}

function applyKeyValue(target, key, value) {
  if (!key) return target;
  const segments = key.split('.');
  let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
    } else {
      if (!cursor[segment] || typeof cursor[segment] !== 'object') {
        cursor[segment] = {};
      }
      cursor = cursor[segment];
    }
  });
  return target;
}

class LLMIntegrationService {
  constructor() {
    // 配置 Moonshot API
    this.apiConfig = config.moonshot;
    if (!this.apiConfig.apiKey) {
      logger.warn('OPENAI_API_KEY not configured – LLM integration will operate in fallback mode.');
    }

    this.openai = this.apiConfig.apiKey
      ? new OpenAI({ apiKey: this.apiConfig.apiKey, baseURL: this.apiConfig.baseURL })
      : null;

    // 加载 Prompt 文件
    this.systemPrompt = this.loadPromptFromFile();
    this.fieldPromptMap = new Map(DEFAULT_FIELD_PROMPTS.map((item) => [item.key, item]));
  }

  /**
   * 从文件加载系统 Prompt
   * @returns {string} 系统 Prompt 内容
   */
  loadPromptFromFile() {
    try {
      const systemPrompt = fs.readFileSync(PROMPT_FILE_PATH, 'utf-8');
      logger.debug({ promptLength: systemPrompt.length }, 'Prompt 文件加载成功');
      return systemPrompt;
    } catch (error) {
      logger.error({ err: error }, '错误：无法读取 Prompt 文件');
      // 提供一个基本的降级 prompt
      return `你是一名临床肿瘤信息结构化工程师。请将病历文本转化为结构化的JSON数据和时间线。

输出格式：
Part 1: 修正后的OCR全文
[修正后的完整病历文本]

Part 2: 结构化JSON数据
{
  "patientProfile": {
    "name": {"value": "XXX", "confidence": "high", "reasoning": ""},
    "gender": {"value": "男/女", "confidence": "high", "reasoning": ""},
    "age": {"value": 58, "confidence": "high", "reasoning": ""}
  },
  "clinicalInformation": {
    "diagnosis": {"primary": "XXX", "secondary": [], "confidence": "high", "reasoning": ""}
  },
  "treatmentHistory": []
}

Part 3: 治疗路径时间线
YYYY-MM-DD: [事件] - [详细信息]`;
    }
  }

  /**
   * 调用 LLM 整合病历信息
   * @param {string} medicalText - 原始病历文本
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 整合后的结构化数据
   */
  async integrateMedicalRecord(medicalText, options = {}) {
    const startTime = Date.now();

    try {
      if (!medicalText || medicalText.trim().length === 0) {
        throw new Error('病历文本不能为空');
      }

      logger.info({ textLength: medicalText.length }, '开始调用 Moonshot API 整合病历信息');

      if (!this.openai) {
        throw Object.assign(new Error('LLM integration disabled – API key missing'), { code: 'llm_disabled' });
      }

      const preparedText = prepareTextForLLM(medicalText);

      const response = await this.openai.chat.completions.create({
        model: 'kimi-k2-turbo-preview', // 使用 Moonshot 模型
        messages: [
          {
            role: 'system',
            content: this.systemPrompt
          },
          {
            role: 'user',
            content: `请整合以下病历信息：\n\n${preparedText}`
          }
        ],
        temperature: 0.1, // 低温度确保输出稳定
        max_tokens: 4000,
        timeout: 120000, // 120秒超时
        ...options
      });

      const processingTime = Date.now() - startTime;
      const llmResponse = response.choices[0].message.content;

      logger.debug({ responseLength: llmResponse.length, processingTime }, 'LLM 响应接收成功');

      // 解析 LLM 响应
      const parsedResult = this.parseResponse(llmResponse);
      const archive = ingestLLMStructuredData(
        createPatientArchive(),
        parsedResult.structuredData,
        { source: 'llm.integration', confidence: 'high' }
      );

      return {
        success: true,
        correctedText: parsedResult.correctedText,
        structuredData: parsedResult.structuredData,
        clinicalArchive: archive,
        timeline: parsedResult.timeline,
        metadata: {
          provider: 'moonshot',
          model: 'kimi-k2-turbo-preview',
          processingTime: processingTime,
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
          processedAt: new Date()
        }
      };

    } catch (error) {
      logger.error({ err: error }, 'LLM 整合失败');
      
      const processingTime = Date.now() - startTime;
      
      // 提供降级处理
      if (error.code === 'insufficient_quota' || error.code === 'llm_disabled' || error.code === 'llm_phi_disallowed') {
        return this.fallbackProcessing(medicalText, {
          error: error.code === 'llm_disabled'
            ? error.message
            : (error.code === 'llm_phi_disallowed' ? error.message : 'API 配额不足'),
          processingTime: processingTime
        });
      }

      if (error.code === 'invalid_api_key') {
        return this.fallbackProcessing(medicalText, {
          error: 'API 密钥无效',
          processingTime: processingTime
        });
      }

      return {
        success: false,
        error: error.message,
        correctedText: medicalText, // 返回原始文本
        structuredData: null,
        clinicalArchive: createPatientArchive(),
        timeline: null,
        metadata: {
          provider: 'moonshot',
          model: 'kimi-k2-turbo-preview',
          processingTime: processingTime,
          errorMessage: error.message,
          processedAt: new Date()
        }
      };
    }
  }

  resolveFieldConfigs(fieldConfigs = []) {
    if (!Array.isArray(fieldConfigs) || fieldConfigs.length === 0) {
      return DEFAULT_FIELD_PROMPTS;
    }

    const configs = [];

    fieldConfigs.forEach((item, index) => {
      if (!item) return;

      if (typeof item === 'string') {
        const defaultConfig = this.fieldPromptMap.get(item);
        if (defaultConfig) {
          configs.push(defaultConfig);
        } else {
          configs.push({
            key: item,
            type: 'string',
            prompt: `提取字段「${item}」。若病历未提及，请返回 null。`
          });
        }
        return;
      }

      if (typeof item === 'object' && item.key) {
        const defaultConfig = this.fieldPromptMap.get(item.key);
        configs.push({
          ...defaultConfig,
          ...item,
          prompt: item.prompt || defaultConfig?.prompt || `提取字段「${item.key}」。若病历未提及，请返回 null。`,
          type: item.type || defaultConfig?.type || 'string'
        });
      } else {
        logger.warn({ item, index }, '忽略无效的字段配置');
      }
    });

    return configs.length > 0 ? configs : DEFAULT_FIELD_PROMPTS;
  }

  parseFieldExtraction(content, fieldKey) {
    if (!content) {
      return {
        value: null,
        confidence: 'medium',
        evidence: '',
        reasoning: ''
      };
    }

    const cleaned = sanitizeJsonBlock(content);

    if (!cleaned) {
      return {
        value: null,
        confidence: 'medium',
        evidence: '',
        reasoning: ''
      };
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        const value = parsed.value !== undefined ? parsed.value : (parsed.result !== undefined ? parsed.result : null);
        return {
          value,
          confidence: normalizeConfidenceLevel(parsed.confidence || parsed.confidence_level),
          evidence: parsed.evidence || parsed.reference || parsed.citation || '',
          reasoning: parsed.reasoning || parsed.explanation || ''
        };
      }
    } catch (error) {
      logger.warn({ err: error, fieldKey, preview: cleaned.slice(0, 200) }, '字段提取 JSON 解析失败');
    }

    return {
      value: cleaned,
      confidence: 'low',
      evidence: '',
      reasoning: ''
    };
  }

  async callLLMForField(medicalText, fieldConfig) {
    const preparedText = prepareTextForLLM(medicalText);
    const response = await this.openai.chat.completions.create({
      model: 'kimi-k2-turbo-preview',
      messages: [
        {
          role: 'system',
          content: FIELD_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            '原始病历文本：',
            preparedText,
            '',
            `任务：${fieldConfig.prompt}`,
            '',
            '请严格按要求返回 JSON 对象。'
          ].join('\n')
        }
      ],
      temperature: 0.1,
      max_tokens: 800,
      timeout: 120000 // 120秒超时
    });

    const messageContent = response.choices?.[0]?.message?.content || '';
    const parsed = this.parseFieldExtraction(messageContent, fieldConfig.key);
    const coercedValue = coerceFieldValue(fieldConfig.type, parsed.value);

    const entry = {
      key: fieldConfig.key,
      prompt: fieldConfig.prompt,
      model: 'kimi-k2-turbo-preview',
      rawValue: parsed.value ?? null,
      value: coercedValue,
      confidence: parsed.confidence,
      evidence: parsed.evidence || '',
      reasoning: parsed.reasoning || ''
    };

    return {
      entry,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      }
    };
  }

  async extractMedicalFields(medicalText, fieldConfigs = []) {
    const startedAt = Date.now();
    const entries = {};
    const structuredData = {};
    const metadata = {
      provider: this.openai ? 'moonshot' : 'fallback',
      model: this.openai ? 'kimi-k2-turbo-preview' : 'none',
      fieldsRequested: 0,
      successfulCalls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      startedAt: new Date()
    };

    try {
      if (!medicalText || !medicalText.trim()) {
        throw new Error('病历文本不能为空');
      }

      const resolvedFields = this.resolveFieldConfigs(fieldConfigs);
      metadata.fieldsRequested = resolvedFields.length;

      if (!this.openai) {
        throw Object.assign(new Error('LLM integration disabled – API key missing'), { code: 'llm_disabled' });
      }

      for (const fieldConfig of resolvedFields) {
        try {
          const { entry, usage } = await this.callLLMForField(medicalText, fieldConfig);
          entries[fieldConfig.key] = entry;
          applyKeyValue(structuredData, fieldConfig.key, entry.value);
          metadata.successfulCalls += 1;
          metadata.totalPromptTokens += usage.promptTokens;
          metadata.totalCompletionTokens += usage.completionTokens;
          metadata.totalTokens += usage.totalTokens || (usage.promptTokens + usage.completionTokens);
        } catch (error) {
          logger.warn({ err: error, field: fieldConfig.key }, '单字段提取失败');
          entries[fieldConfig.key] = {
            key: fieldConfig.key,
            prompt: fieldConfig.prompt,
            model: 'kimi-k2-turbo-preview',
            rawValue: null,
            value: null,
            confidence: 'low',
            evidence: '',
            reasoning: '',
            error: error.message
          };
        }
      }

      metadata.completedAt = new Date();
      metadata.totalProcessingTime = Date.now() - startedAt;

      return {
        success: metadata.successfulCalls > 0,
        entries,
        structuredData,
        metadata
      };
    } catch (error) {
      logger.error({ err: error }, '字段批量提取失败');
      metadata.completedAt = new Date();
      metadata.totalProcessingTime = Date.now() - startedAt;
      metadata.errorMessage = error.message;

      if (error.code === 'llm_disabled' || error.code === 'llm_phi_disallowed') {
        metadata.provider = 'fallback';
        metadata.model = 'none';
      }

      return {
        success: false,
        entries,
        structuredData,
        metadata
      };
    }
  }

  /**
   * 解析 LLM 响应并提取三个部分
   * @param {string} response - LLM 响应文本
   * @returns {Object} 解析后的结果
   */
  parseResponse(response) {
    try {
      // 寻找三个部分的分隔标志 - 更灵活的匹配
      const colonPattern = '[：:]';
      const part1Match = response.match(new RegExp(`Part\\s*1${colonPattern}[\\s]*([\\s\\S]*?)(?=Part\\s*2|$)`, 'i'));
      const part2Match = response.match(new RegExp(`Part\\s*2${colonPattern}[\\s]*([\\s\\S]*?)(?=Part\\s*3|$)`, 'i'));
      const part3Match = response.match(new RegExp(`Part\\s*3${colonPattern}[\\s]*([\\s\\S]*?)$`, 'i'));

      let correctedText = '';
      let structuredData = null;
      let timeline = '';

      // 提取修正后的文本 (Part 1)
      if (part1Match) {
        correctedText = part1Match[1].trim()
          .replace(/^```[a-zA-Z]*\n?/, '') // 移除开头的代码块标记
          .replace(/\n?```$/, ''); // 移除结尾的代码块标记
      }

      // 提取结构化 JSON (Part 2) - 改进的 JSON 提取
      if (part2Match) {
        let jsonText = part2Match[1].trim();
        
        // 更精确地提取 JSON - 寻找 { 到 } 的完整结构
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
          
          try {
            structuredData = JSON.parse(jsonText);
            logger.debug('成功解析结构化数据');
          } catch (jsonError) {
            logger.warn({ err: jsonError, preview: `${jsonText.substring(0, 200)}...` }, 'JSON 解析失败');
            
            // 尝试修复常见的 JSON 问题
            try {
              // 移除可能的注释
              const cleanedJson = jsonText.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
              structuredData = JSON.parse(cleanedJson);
              logger.debug('修复后成功解析结构化数据');
            } catch (retryError) {
              logger.error({ err: retryError }, '重试解析也失败');
            }
          }
        } else {
          logger.warn('未找到有效的 JSON 结构');
        }
      }

      // 提取时间线 (Part 3)
      if (part3Match) {
        timeline = part3Match[1].trim()
          .replace(/^```[a-zA-Z]*\n?/, '')
          .replace(/\n?```$/, '');
      }

      return {
        correctedText: correctedText || '解析失败',
        structuredData: structuredData,
        timeline: timeline || '时间线解析失败'
      };

    } catch (error) {
      logger.error({ err: error }, '响应解析错误');
      return {
        correctedText: '解析失败',
        structuredData: null,
        timeline: '时间线解析失败'
      };
    }
  }

  /**
   * 降级处理方法
   * @param {string} medicalText - 原始文本
   * @param {Object} errorInfo - 错误信息
   * @returns {Object} 降级处理结果
   */
  fallbackProcessing(medicalText, errorInfo) {
    logger.info('使用降级处理模式');

    // 基本的结构化数据模板
    const fallbackStructuredData = {
      patientProfile: {
        name: { value: null, confidence: "low", reasoning: "降级模式无法提取姓名" },
        gender: { value: null, confidence: "low", reasoning: "降级模式无法确定性别" },
        age: { value: null, confidence: "low", reasoning: "降级模式无法提取年龄" }
      },
      clinicalInformation: {
        diagnosis: { 
          primary: null, 
          secondary: [], 
          confidence: "low", 
          reasoning: "降级模式无法解析诊断信息" 
        }
      },
      treatmentHistory: []
    };

    return {
      success: false,
      correctedText: medicalText,
      structuredData: fallbackStructuredData,
      clinicalArchive: ingestLLMStructuredData(createPatientArchive(), fallbackStructuredData, { source: 'llm.fallback', confidence: 'low' }),
      timeline: '降级模式：无法生成时间线',
      metadata: {
        provider: 'fallback',
        model: 'none',
        processingTime: errorInfo.processingTime,
        errorMessage: errorInfo.error,
        processedAt: new Date()
      }
    };
  }

  /**
   * 健康检查方法
   * @returns {Promise<Object>} 服务状态
   */
  async healthCheck() {
    try {
      const hasApiKey = !!process.env.OPENAI_API_KEY;
      const hasBaseUrl = !!process.env.baseURL;
      const hasPromptFile = fs.existsSync(PROMPT_FILE_PATH);

      return {
        status: hasApiKey && hasBaseUrl && hasPromptFile ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        configuration: {
          apiKeyConfigured: hasApiKey,
          baseUrlConfigured: hasBaseUrl,
          promptFileExists: hasPromptFile,
          baseUrl: process.env.baseURL
        },
        provider: 'moonshot',
        model: 'moonshot-v1-8k'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

module.exports = LLMIntegrationService;
