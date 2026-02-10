const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');
const { prepareTextForLLM } = require('../utils/llmPrivacy');
const { getRedisClient, isRedisEnabled } = require('../config/redis');
const { registerQueue } = require('../queues');
const { MedicalRecord, Patient } = require('../models');
const {
  createPatientArchive,
  ingestStepwiseResults,
  mergeArchives,
  archiveToLegacyStructuredData
} = require('../utils/patientArchive');

const STEPWISE_QUEUE_NAME = 'stepwise-extraction';

// 加载医疗数据schema
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'docs', 'schemas', 'medical-data-schema.json');
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'docs', 'prompts', 'stepwise');

const stepPrompts = {
  1: 'step_1_basic_info.txt',
  2: 'step_2_diagnosis_staging.txt',
  3: 'step_3_metastasis.txt',
  4: 'step_4_performance_status.txt',
  5: 'step_5_surgical_history.txt',
  6: 'step_6_systemic_treatments.txt',
  7: 'step_7_lab_values.txt',
  8: 'step_8_comorbidities.txt',
  9: 'step_9_molecular_markers.txt',
  10: 'step_10_adverse_events.txt',
  11: 'step_11_special_conditions.txt'
};

const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

function extractFirstJsonObject(text = '') {
  const input = String(text || '');
  const start = input.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return input.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeConfidence(input) {
  if (!input) return 'medium';
  const normalized = String(input).trim().toLowerCase();
  if (CONFIDENCE_LEVELS.has(normalized)) return normalized;
  if (/高/.test(normalized)) return 'high';
  if (/低/.test(normalized)) return 'low';
  return 'medium';
}

function coerceNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (/^(true|yes|y|是|有|存在|阳性)$/.test(text)) return true;
  if (/^(false|no|n|否|无|不存在|阴性)$/.test(text)) return false;
  return null;
}

function normalizeGender(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (/^(male|m|男)$/.test(text)) return 'male';
  if (/^(female|f|女)$/.test(text)) return 'female';
  return null;
}

function normalizeStepData(stepNumber, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: null, confidence: 'medium', reasoning: '', evidence: '' };
  }

  const confidence = normalizeConfidence(raw.confidence);
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';
  const evidence = typeof raw.evidence === 'string' ? raw.evidence : '';

  const data = { ...raw };
  delete data.confidence;
  delete data.reasoning;
  delete data.evidence;

  const ensureObject = (value, fallback) => (value && typeof value === 'object' && !Array.isArray(value) ? value : fallback);
  const ensureArray = (value) => (Array.isArray(value) ? value : (value ? [value] : []));

  switch (stepNumber) {
    case 1:
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          age: coerceNumber(data.age),
          gender: normalizeGender(data.gender),
          pregnancy_status: data.pregnancy_status ?? null,
          ethnicity: data.ethnicity ?? null,
          height_cm: coerceNumber(data.height_cm ?? data.height),
          weight_kg: coerceNumber(data.weight_kg ?? data.weight)
        }
      };
    case 2:
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          primary_diagnosis: data.primary_diagnosis ?? null,
          pathology_type: data.pathology_type ?? null,
          grade: data.grade ?? null,
          staging_system: data.staging_system ?? null,
          staging_value: data.staging_value ?? null,
          diagnosis_date: data.diagnosis_date ?? null,
          mvi_grade: data.mvi_grade ?? null
        }
      };
    case 3: {
      const cns = ensureObject(data.cns_metastasis, {});
      const effusion = ensureObject(data.ascites_pleural_effusion, {});
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          metastasis_sites: ensureArray(data.metastasis_sites).map((v) => String(v)),
          measurable_lesions: coerceBoolean(data.measurable_lesions),
          cns_metastasis: {
            present: coerceBoolean(cns.present),
            treated: coerceBoolean(cns.treated),
            stable: coerceBoolean(cns.stable),
            size_max_cm: coerceNumber(cns.size_max_cm)
          },
          bone_metastasis: ensureArray(data.bone_metastasis).map((v) => String(v)),
          ascites_pleural_effusion: {
            ascites: coerceBoolean(effusion.ascites),
            pleural_effusion: coerceBoolean(effusion.pleural_effusion),
            requires_drainage: coerceBoolean(effusion.requires_drainage)
          }
        }
      };
    }
    case 4:
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          ecog_score: coerceNumber(data.ecog_score),
          kps_score: coerceNumber(data.kps_score),
          expected_survival_months: coerceNumber(data.expected_survival_months),
          functional_status_description: data.functional_status_description ?? null
        }
      };
    case 5:
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          surgical_history: ensureArray(data.surgical_history),
          local_treatments: ensureArray(data.local_treatments)
        }
      };
    case 6:
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          systemic_treatments: ensureArray(data.systemic_treatments),
          total_treatment_lines: coerceNumber(data.total_treatment_lines),
          last_treatment_date: data.last_treatment_date ?? null
        }
      };
    case 7: {
      const blood = ensureObject(data.blood_counts, {});
      const liver = ensureObject(data.liver_function, {});
      const kidney = ensureObject(data.kidney_function, {});
      const coag = ensureObject(data.coagulation, {});
      const tumor = ensureArray(data.tumor_markers);
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          lab_date: data.lab_date ?? null,
          blood_counts: {
            wbc: coerceNumber(blood.wbc),
            anc: coerceNumber(blood.anc ?? blood.neutrophils),
            platelet: coerceNumber(blood.platelet),
            hemoglobin: coerceNumber(blood.hemoglobin)
          },
          liver_function: {
            alt: coerceNumber(liver.alt),
            ast: coerceNumber(liver.ast),
            tbil: coerceNumber(liver.tbil),
            dbil: coerceNumber(liver.dbil),
            alb: coerceNumber(liver.alb ?? liver.albumin),
            alp: coerceNumber(liver.alp),
            ggt: coerceNumber(liver.ggt),
            child_pugh_score: liver.child_pugh_score ?? null
          },
          kidney_function: {
            creatinine: coerceNumber(kidney.creatinine),
            bun: coerceNumber(kidney.bun ?? kidney.urea),
            egfr: coerceNumber(kidney.egfr),
            ccr: coerceNumber(kidney.ccr)
          },
          coagulation: {
            pt: coerceNumber(coag.pt),
            aptt: coerceNumber(coag.aptt),
            inr: coerceNumber(coag.inr),
            fibrinogen: coerceNumber(coag.fibrinogen),
            d_dimer: coerceNumber(coag.d_dimer)
          },
          tumor_markers: tumor
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
              marker: entry.marker ? String(entry.marker) : null,
              value: coerceNumber(entry.value),
              unit: entry.unit ?? null,
              reference_range: entry.reference_range ?? null,
              trend: entry.trend ?? null
            }))
            .filter((entry) => entry.marker)
        }
      };
    }
    case 8: {
      const viral = ensureObject(data.viral_hepatitis, {});
      const otherInf = ensureObject(data.other_infections, {});
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          viral_hepatitis: {
            hbv_status: viral.hbv_status ?? null,
            hbv_dna: viral.hbv_dna ?? null,
            hcv_status: viral.hcv_status ?? null,
            hcv_rna: viral.hcv_rna ?? null,
            antiviral_treatment: coerceBoolean(viral.antiviral_treatment)
          },
          other_infections: {
            hiv_status: otherInf.hiv_status ?? null
          },
          cardiovascular: ensureObject(data.cardiovascular, {}),
          metabolic_disorders: ensureObject(data.metabolic_disorders, {}),
          autoimmune_diseases: ensureArray(data.autoimmune_diseases).map((v) => String(v))
        }
      };
    }
    case 9:
      return {
        confidence,
        reasoning,
        evidence,
        data: {
          genetic_mutations: ensureArray(data.genetic_mutations).map((v) => String(v)),
          msi_status: data.msi_status ?? null,
          tmb: ensureObject(data.tmb, null),
          pd_l1_status: ensureObject(data.pd_l1_status, null)
        }
      };
    case 10:
      return { confidence, reasoning, evidence, data: { severe_adverse_events: ensureArray(data.severe_adverse_events) } };
    case 11:
      return { confidence, reasoning, evidence, data: { special_conditions: ensureObject(data.special_conditions, {}) } };
    default:
      return { confidence, reasoning, evidence, data };
  }
}

class StepwiseLLMService {
  constructor() {
    this.apiConfig = config.moonshot;
    this.openai = this.apiConfig.apiKey
      ? new OpenAI({ apiKey: this.apiConfig.apiKey, baseURL: this.apiConfig.baseURL })
      : null;
    
    // 加载医疗数据schema
    this.schema = this.loadSchema();
    this.promptCache = new Map();
    
    // 初始化提取步骤状态管理
    this.redisClient = getRedisClient();
    this.useRedis = Boolean(isRedisEnabled() && this.redisClient);
    this.cachePrefix = 'stepwise:job:';
    this.extractionJobs = this.useRedis ? null : new Map();
    this.queue = registerQueue(
      STEPWISE_QUEUE_NAME,
      async (job) => {
        await this.executeStepwiseExtraction(job.data.jobId);
      },
      {
        concurrency: Number(process.env.STEPWISE_CONCURRENCY || 2),
        attempts: Number(process.env.STEPWISE_MAX_ATTEMPTS || 3),
        backoff: {
          type: 'exponential',
          delay: Number(process.env.STEPWISE_BACKOFF_MS || 5000)
        }
      }
    );
  }

  /**
   * 加载医疗数据标准化schema
   */
  loadSchema() {
    try {
      const schemaContent = fs.readFileSync(SCHEMA_PATH, 'utf8');
      return JSON.parse(schemaContent);
    } catch (error) {
      logger.error({ err: error }, '无法加载医疗数据schema');
      return null;
    }
  }

  /**
   * 启动分步医疗数据提取流程
   * @param {string} medicalText - 病历文本
   * @param {string} patientId - 患者ID
   * @returns {Promise<Object>} 提取任务信息
   */
  async startStepwiseExtraction(medicalText, patientId, options = {}) {
    const jobId = `extraction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const patientIdString = patientId ? String(patientId) : '';
    const seedArchive = options.seedArchive
      ? mergeArchives(createPatientArchive(patientIdString), options.seedArchive)
      : createPatientArchive(patientIdString);

    const jobInfo = {
      jobId,
      patientId: patientIdString,
      medicalText,
      startTime: new Date(),
      status: 'running',
      currentStep: 0,
      totalSteps: 11,
      results: {},
      errors: [],
      metadata: {
        provider: 'moonshot',
        model: 'kimi-k2-turbo-preview'
      },
      clinicalArchive: seedArchive,
      recordId: options.recordId ? String(options.recordId) : null,
      userId: options.userId ? String(options.userId) : null
    };

    await this.saveJob(jobInfo);

    // 异步执行分步提取
    await this.queue.add('stepwise', { jobId });

    return { jobId, status: 'running', totalSteps: 11 };
  }

  /**
   * 执行完整的分步提取流程
   * @param {string} jobId - 任务ID
   */
  async executeStepwiseExtraction(jobId) {
    const jobInfo = await this.loadJob(jobId);
    if (!jobInfo) {
      throw new Error(`提取任务 ${jobId} 不存在`);
    }

    logger.info({ jobId, patientId: jobInfo.patientId }, '开始执行分步医疗数据提取');

    await this.runExtractionStep(jobInfo, 1, 'step_1', () => this.extractBasicInfo(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 2, 'step_2', () => this.extractDiagnosisStaging(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 3, 'step_3', () => this.extractMetastasisLesions(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 4, 'step_4', () => this.extractPerformanceStatus(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 5, 'step_5', () => this.extractSurgicalHistory(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 6, 'step_6', () => this.extractSystemicTreatments(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 7, 'step_7', () => this.extractLabValues(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 8, 'step_8', () => this.extractComorbidities(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 9, 'step_9', () => this.extractMolecularMarkers(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 10, 'step_10', () => this.extractAdverseEvents(jobInfo.medicalText));
    await this.runExtractionStep(jobInfo, 11, 'step_11', () => this.extractSpecialConditions(jobInfo.medicalText));

    const aggregatedArchive = ingestStepwiseResults(
      jobInfo.clinicalArchive || createPatientArchive(jobInfo.patientId),
      jobInfo.results,
      'stepwise'
    );

    const mergedArchive = mergeArchives(jobInfo.clinicalArchive, aggregatedArchive);
    jobInfo.clinicalArchive = mergedArchive;

    if (jobInfo.recordId) {
      try {
        if (!jobInfo.userId) {
          logger.error({ jobId, recordId: jobInfo.recordId }, 'Stepwise job missing userId; refusing to persist results to record');
          // Continue the job lifecycle, but do not touch records without ownership context.
          throw new Error('Missing userId for record persistence');
        }

        const medicalRecord = await MedicalRecord.findOne({ _id: jobInfo.recordId, userId: jobInfo.userId });
        if (!medicalRecord) {
          logger.warn({ jobId, recordId: jobInfo.recordId }, 'Stepwise extraction completed but medical record missing');
        } else {
          const existingArchive = medicalRecord.clinicalArchive || createPatientArchive(medicalRecord.patientId?.toString?.() || jobInfo.recordId);
          const updatedArchive = mergeArchives(existingArchive, mergedArchive);
          const legacyStructured = archiveToLegacyStructuredData(updatedArchive);

          medicalRecord.clinicalArchive = updatedArchive;
          medicalRecord.structuredData = legacyStructured;
          medicalRecord.markModified('clinicalArchive');
          await medicalRecord.save();

          if (medicalRecord.patientId) {
            await Patient.findOneAndUpdate({ _id: medicalRecord.patientId, userId: jobInfo.userId }, {
              latestRecordId: medicalRecord._id,
              latestClinicalArchive: updatedArchive,
              latestStructuredData: legacyStructured,
              $currentDate: { updatedAt: true }
            });
          }
        }
      } catch (error) {
        logger.error({ err: error, jobId, recordId: jobInfo.recordId }, 'Failed to persist stepwise archive to medical record');
      }
    }

    jobInfo.status = jobInfo.errors.length > 0 ? 'completed_with_warnings' : 'completed';
    jobInfo.endTime = new Date();
    jobInfo.processingTime = jobInfo.endTime - jobInfo.startTime;

    logger.info({
      jobId,
      patientId: jobInfo.patientId,
      processingTime: jobInfo.processingTime,
      successfulSteps: this.countSuccessfulSteps(jobInfo.results),
      totalSteps: jobInfo.totalSteps,
      errors: jobInfo.errors.length,
      status: jobInfo.status
    }, '分步医疗数据提取完成');

    await this.saveJob(jobInfo);
  }

  async runExtractionStep(jobInfo, stepNumber, stepKey, handler) {
    jobInfo.currentStep = stepNumber;
    try {
      const result = await handler();
      jobInfo.results[stepKey] = result;
      if (!result.success) {
        jobInfo.errors.push({
          step: stepNumber,
          error: result.error || 'Extraction step failed',
          metadata: result.metadata,
          timestamp: new Date()
        });
      }
    } catch (error) {
      jobInfo.results[stepKey] = {
        success: false,
        data: null,
        error: error.message,
        metadata: { step: stepNumber }
      };
      jobInfo.errors.push({
        step: stepNumber,
        error: error.message,
        timestamp: new Date()
      });
      logger.error({ err: error, stepNumber, jobId: jobInfo.jobId }, '分步提取单步执行异常');
    }
    await this.saveJob(jobInfo);
  }

  countSuccessfulSteps(results) {
    return Object.values(results).filter((stepResult) => stepResult && stepResult.success && stepResult.data).length;
  }

  /**
   * 获取提取任务状态
   * @param {string} jobId - 任务ID
   * @returns {Object} 任务状态信息
   */
  async getExtractionStatus(jobId) {
    const jobInfo = await this.loadJob(jobId);
    if (!jobInfo) {
      return { error: '任务不存在' };
    }

    return {
      jobId: jobInfo.jobId,
      status: jobInfo.status,
      currentStep: jobInfo.currentStep,
      totalSteps: jobInfo.totalSteps,
      progress: Math.round((jobInfo.currentStep / jobInfo.totalSteps) * 100),
      results: jobInfo.results,
      errors: jobInfo.errors,
      startTime: jobInfo.startTime,
      endTime: jobInfo.endTime,
      processingTime: jobInfo.processingTime
    };
  }

  /**
   * 调用LLM执行单步提取
   * @param {string} medicalText - 病历文本
   * @param {string} prompt - 提示语
   * @param {number} stepNumber - 步骤编号
   * @returns {Promise<Object>} 提取结果
   */
  loadPrompt(stepNumber) {
    const filename = stepPrompts[stepNumber];
    if (!filename) {
      throw new Error(`No prompt defined for step ${stepNumber}`);
    }
    if (this.promptCache.has(stepNumber)) {
      return this.promptCache.get(stepNumber);
    }
    const filePath = path.join(PROMPTS_DIR, filename);
    try {
      const prompt = fs.readFileSync(filePath, 'utf8');
      this.promptCache.set(stepNumber, prompt);
      return prompt;
    } catch (err) {
      logger.error({ err, stepNumber, filePath }, 'Failed to load step prompt');
      throw err;
    }
  }

  async callLLMForStep(medicalText, prompt, stepNumber) {
    if (!this.openai) {
      logger.warn({ stepNumber }, 'LLM 未配置，返回降级结果');
      return {
        success: false,
        data: null,
        error: 'LLM integration disabled',
        metadata: {
          processingTime: 0,
          tokens: 0,
          step: stepNumber,
          provider: 'disabled'
        }
      };
    }

    const startTime = Date.now();

    try {
      const preparedText = prepareTextForLLM(medicalText);
      const response = await this.openai.chat.completions.create({
        model: 'kimi-k2-turbo-preview',
        messages: [
          {
            role: 'system',
            content: prompt
          },
          {
            role: 'user',
            content: `请根据以下病历文本进行信息提取：\\n\\n${preparedText}`
          }
        ],
        temperature: 0.1,
        max_tokens: 1500
      });

      const content = response.choices?.[0]?.message?.content || '';
      const usage = response.usage || {};

      // 尝试解析JSON结果
      try {
        const jsonText = extractFirstJsonObject(content);
        const parsedResult = jsonText ? JSON.parse(jsonText) : null;
        const normalized = normalizeStepData(stepNumber, parsedResult);
        if (!normalized.data) {
          return {
            success: false,
            data: null,
            error: `步骤${stepNumber}未返回可解析的JSON对象`,
            rawResponse: content,
            metadata: {
              processingTime: Date.now() - startTime,
              tokens: usage.total_tokens || 0,
              step: stepNumber,
              provider: 'moonshot'
            }
          };
        }

        return {
          success: true,
          data: normalized.data,
          confidence: normalized.confidence,
          reasoning: normalized.reasoning,
          evidence: normalized.evidence,
          rawResponse: content,
          metadata: {
            processingTime: Date.now() - startTime,
            tokens: usage.total_tokens || 0,
            step: stepNumber
          }
        };
      } catch (parseError) {
        logger.warn({
          err: parseError,
          stepNumber,
          preview: content.substring(0, 240)
        }, `步骤${stepNumber}的JSON解析失败`);
        return {
          success: false,
          data: null,
          error: `步骤${stepNumber}的JSON解析失败: ${parseError.message}`,
          rawResponse: content,
          metadata: {
            processingTime: Date.now() - startTime,
            tokens: usage.total_tokens || 0,
            step: stepNumber
          }
        };
      }
    } catch (error) {
      logger.error({ err: error, stepNumber }, `步骤${stepNumber}的LLM调用失败`);
      if (error.code === 'llm_phi_disallowed') {
        return {
          success: false,
          error: error.message,
          data: null,
          metadata: {
            processingTime: Date.now() - startTime,
            step: stepNumber,
            provider: 'disabled'
          }
        };
      }
      return {
        success: false,
        error: error.message,
        data: null,
        metadata: {
          processingTime: Date.now() - startTime,
          step: stepNumber
        }
      };
    }
  }

  /**
   * 步骤1: 提取人口学信息
   */
  async extractBasicInfo(medicalText) {
    const prompt = this.loadPrompt(1);
    return await this.callLLMForStep(medicalText, prompt, 1);
  }

  /**
   * 步骤2: 提取诊断与分期信息
   */
  async extractDiagnosisStaging(medicalText) {
    const prompt = this.loadPrompt(2);
    return await this.callLLMForStep(medicalText, prompt, 2);
  }

  /**
   * 步骤3: 提取转移与病灶信息
   */
  async extractMetastasisLesions(medicalText) {
    const prompt = this.loadPrompt(3);
    return await this.callLLMForStep(medicalText, prompt, 3);
  }

  /**
   * 步骤4: 提取体能状态与生存预期
   */
  async extractPerformanceStatus(medicalText) {
    const prompt = this.loadPrompt(4);
    return await this.callLLMForStep(medicalText, prompt, 4);
  }

  /**
   * 步骤5: 提取既往手术和局部治疗史
   */
  async extractSurgicalHistory(medicalText) {
    const prompt = this.loadPrompt(5);
    return await this.callLLMForStep(medicalText, prompt, 5);
  }

  /**
   * 步骤6: 提取全身药物治疗史
   */
  async extractSystemicTreatments(medicalText) {
    const prompt = this.loadPrompt(6);
    return await this.callLLMForStep(medicalText, prompt, 6);
  }

  /**
   * 步骤7: 提取实验室与器官功能
   */
  async extractLabValues(medicalText) {
    const prompt = this.loadPrompt(7);
    return await this.callLLMForStep(medicalText, prompt, 7);
  }

  /**
   * 步骤8: 提取合并症与感染状态
   */
  async extractComorbidities(medicalText) {
    const prompt = this.loadPrompt(8);
    return await this.callLLMForStep(medicalText, prompt, 8);
  }

  /**
   * 步骤9: 提取分子检测与基因突变
   */
  async extractMolecularMarkers(medicalText) {
    const prompt = this.loadPrompt(9);
    return await this.callLLMForStep(medicalText, prompt, 9);
  }

  /**
   * 步骤10: 提取不良反应与毒性
   */
  async extractAdverseEvents(medicalText) {
    const prompt = this.loadPrompt(10);
    return await this.callLLMForStep(medicalText, prompt, 10);
  }

  /**
   * 步骤11: 提取特殊情况与社会因素
   */
  async extractSpecialConditions(medicalText) {
    const prompt = this.loadPrompt(11);
    return await this.callLLMForStep(medicalText, prompt, 11);
  }

  /**
   * 获取完整的结构化提取结果
   * @param {string} jobId - 任务ID
   * @returns {Object} 整合后的结构化数据
   */
  async getStructuredResult(jobId) {
    const jobInfo = await this.loadJob(jobId);
    if (!jobInfo || (jobInfo.status !== 'completed' && jobInfo.status !== 'completed_with_warnings')) {
      return null;
    }

    // 整合所有步骤的结果
    const clinicalArchive = jobInfo.clinicalArchive;
    const legacyStructuredData = archiveToLegacyStructuredData(clinicalArchive);

    return {
      patientId: jobInfo.patientId,
      extractionJobId: jobId,
      extractedAt: jobInfo.endTime,
      processingTime: jobInfo.processingTime,
      clinicalArchive,
      legacyStructuredData,
      extractionMetadata: {
        totalSteps: jobInfo.totalSteps,
        successfulSteps: this.countSuccessfulSteps(jobInfo.results),
        errors: jobInfo.errors,
        confidence: this.assessOverallConfidence(jobInfo.results),
        status: jobInfo.status
      }
    };
  }

  /**
   * 评估整体提取可信度
   */
  assessOverallConfidence(results) {
    const confidenceLevels = Object.values(results)
      .filter(result => result.success && result.data && result.data.confidence)
      .map(result => result.data.confidence);

    const highCount = confidenceLevels.filter(c => c === 'high').length;
    const mediumCount = confidenceLevels.filter(c => c === 'medium').length;
    const lowCount = confidenceLevels.filter(c => c === 'low').length;

    if (highCount >= mediumCount + lowCount) return 'high';
    if (mediumCount >= lowCount) return 'medium';
    return 'low';
  }

  /**
   * 清理过期的提取任务
   */
  cleanupExpiredJobs() {
    if (!this.extractionJobs) {
      // Redis-backed jobs rely on key TTL for cleanup
      return;
    }
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时

    for (const [jobId, jobInfo] of this.extractionJobs.entries()) {
      if (now - jobInfo.startTime.getTime() > maxAge) {
        this.extractionJobs.delete(jobId);
      }
    }
  }

  getJobKey(jobId) {
    return `${this.cachePrefix}${jobId}`;
  }

  async loadJob(jobId) {
    if (this.useRedis && this.redisClient) {
      const payload = await this.redisClient.get(this.getJobKey(jobId));
      if (!payload) return null;
      const jobInfo = JSON.parse(payload);
      if (jobInfo.startTime) jobInfo.startTime = new Date(jobInfo.startTime);
      if (jobInfo.endTime) jobInfo.endTime = new Date(jobInfo.endTime);
      return jobInfo;
    }
    return this.extractionJobs.get(jobId) || null;
  }

  async saveJob(jobInfo) {
    if (this.useRedis && this.redisClient) {
      const ttlSeconds = 24 * 60 * 60;
      const payload = {
        ...jobInfo,
        startTime: jobInfo.startTime?.toISOString?.() || jobInfo.startTime,
        endTime: jobInfo.endTime?.toISOString?.() || jobInfo.endTime
      };
      await this.redisClient.set(this.getJobKey(jobInfo.jobId), JSON.stringify(payload), 'EX', ttlSeconds);
      return;
    }
    this.extractionJobs.set(jobInfo.jobId, jobInfo);
  }
}

module.exports = StepwiseLLMService;
