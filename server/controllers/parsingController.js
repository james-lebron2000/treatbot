const mongoose = require('mongoose');
const { z } = require('zod');

const { MedicalRecord, Patient } = require('../models');
const config = require('../config');
const cacheService = require('../services/cache');
const logger = require('../utils/logger');
const { HttpError, BadRequestError, NotFoundError } = require('../utils/httpError');
const { defaultContainer } = require('../services/ServiceContainer');
const { normalizeStructuredData } = require('../utils/recordNormalizer');
const { mockNLPParseWithMeta } = require('../utils/mockNLPParser');
const { classifyDocument } = require('../utils/documentClassifier');
const { computeStructuredDataQuality } = require('../utils/dataQuality');
const {
  createPatientArchive,
  mergeArchives
} = require('../utils/patientArchive');
const { refreshPatientLatestData } = require('../utils/medicalHelpers');

const { textParseSchema, fieldExtractionSchema } = require('./medicalSchemas');

function mergeStructuredRecords(base, updates) {
  return { ...base, ...updates };
}

async function parseMedicalText(req, res, next) {
  try {
    const llmService = defaultContainer.deps.llmService;
    const payload = textParseSchema.parse(req.body);
    const {
      text,
      fileId,
      useLLM = false,
      patientId,
      recordId,
      ocrMetadata,
      results,
      overallMetadata
    } = payload;

    logger.info({ userId: req.userId, useLLM }, 'Parsing medical text');

    if (config.llm?.required && useLLM !== true) {
      throw new BadRequestError('本环境要求使用 LLM 解析，请设置 useLLM=true');
    }

    const docClassification = classifyDocument(text);

    let structuredData;
    let clinicalArchive = null;
    let llmIntegrationData = null;
    let extractionEvidence = null;
    let extractionWarnings = [];
    let medicalRecord = null;

    if (useLLM) {
      try {
        const integrationResult = await llmService.integrateMedicalRecord(text);
        if (integrationResult.success && integrationResult.structuredData?.patientProfile) {
          const profile = integrationResult.structuredData.patientProfile;
          const clinical = integrationResult.structuredData.clinicalInformation || {};
          const treatments = integrationResult.structuredData.treatmentHistory || [];

          clinicalArchive = integrationResult.clinicalArchive || null;

          const pick = (field) => {
            if (field === null || field === undefined) return null;
            if (typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'value')) {
              return field.value ?? null;
            }
            return field;
          };

          // Build a richer structuredData (normalized by recordNormalizer later).
          structuredData = {
            // Basic profile
            age: pick(profile.age),
            gender: (() => {
              const g = String(pick(profile.gender) ?? '').trim();
              if (g === '男' || g.toLowerCase() === 'male') return 'male';
              if (g === '女' || g.toLowerCase() === 'female') return 'female';
              return g || null;
            })(),

            // Diagnosis / staging
            primary_diagnosis: pick(clinical.diagnosis?.primary) || pick(clinical.pathology?.type) || null,
            pathology_type: pick(clinical.pathology?.type) || null,
            staging_value: pick(clinical.stage) || pick(clinical.staging) || pick(clinical.tnmStage) || pick(clinical.bclcStage) || null,
            mvi_grade: pick(clinical.pathology?.mvi) || null,
            metastasis_sites: pick(clinical.metastasis?.sites) || pick(clinical.metastasisSites) || [],

            // Performance / symptoms
            ecog_score: pick(clinical.ecogScore) ?? null,
            performance_status: pick(clinical.performanceStatus) || null,
            chief_complaint: pick(clinical.chiefComplaint) || null,
            symptoms: pick(clinical.symptoms) || [],

            // Viral hepatitis / infections
            viral_hepatitis: {
              hbv_status: pick(clinical.hbvStatus) || pick(profile.hbvStatus) || null,
              hbv_dna: pick(clinical.hbvDna) || null,
              hcv_status: pick(clinical.hcvStatus) || null
            },

            // Key labs (best effort)
            lab_values: pick(clinical.labs) || pick(clinical.labValues) || {},

            // Imaging / pathology summaries
            imaging_summary: pick(clinical.imagingSummary) || null,
            pathology_summary: pick(clinical.pathologySummary) || null,

            // Treatment history
            systemic_treatments: Array.isArray(treatments)
              ? treatments.map((t, idx) => ({
                  line: t.line || idx + 1,
                  intent: pick(t.intent) || null,
                  regimen: Array.isArray(t.regimen) ? t.regimen.filter(Boolean) : (t.regimen ? [String(t.regimen)] : []),
                  start_date: pick(t.startDate) || pick(t.start_date) || null,
                  end_date: pick(t.endDate) || pick(t.end_date) || null,
                  response: pick(t.response) || null,
                  reason_stopped: pick(t.reasonStopped) || null,
                  adverse_events: pick(t.adverseEvents) || []
                }))
              : [],
            surgeries: Array.isArray(pick(clinical.surgeries)) ? pick(clinical.surgeries) : [],
            radiotherapy: Array.isArray(pick(clinical.radiotherapy)) ? pick(clinical.radiotherapy) : [],

            // Comorbidities / meds
            comorbidities: pick(clinical.comorbidities) || [],
            medications: pick(clinical.medications) || [],
            allergies: pick(clinical.allergies) || []
          };

          if (clinical.geneticMutations && Array.isArray(clinical.geneticMutations)) {
            structuredData.mutations = clinical.geneticMutations
              .filter((m) => m.status && m.status.includes('突变'))
              .map((m) => m.gene);
          }

          llmIntegrationData = {
            correctedText: integrationResult.correctedText,
            fullStructuredData: integrationResult.structuredData,
            timeline: integrationResult.timeline,
            metadata: integrationResult.metadata
          };
        } else {
          if (config.parsing?.allowFallback) {
            logger.warn('LLM parsing returned empty structured data, falling back to heuristic parse');
            const parsed = mockNLPParseWithMeta(text);
            structuredData = parsed.record;
            extractionEvidence = parsed.meta.evidence;
            extractionWarnings = parsed.meta.warnings || [];
            extractionWarnings.push('LLM 输出为空，已回退到规则解析');
          } else {
            throw new HttpError(502, 'LLM 解析未返回有效结构化结果', { code: 'llm_empty_result' });
          }
        }
      } catch (error) {
        if (config.parsing?.allowFallback) {
          logger.error({ err: error }, 'LLM parsing error, falling back to heuristic parse');
          const parsed = mockNLPParseWithMeta(text);
          structuredData = parsed.record;
          extractionEvidence = parsed.meta.evidence;
          extractionWarnings = parsed.meta.warnings || [];
          extractionWarnings.push('LLM 调用失败，已回退到规则解析');
        } else {
          const message = error?.message || 'LLM parsing failed';
          throw new HttpError(503, `LLM 解析失败：${message}`, { code: error?.code || 'llm_failed' });
        }
      }
    } else {
      const parsed = mockNLPParseWithMeta(text);
      structuredData = parsed.record;
      extractionEvidence = parsed.meta.evidence;
      extractionWarnings = parsed.meta.warnings || [];
    }

    structuredData = normalizeStructuredData(structuredData || {});
    const dataQuality = computeStructuredDataQuality(structuredData);

    if (recordId) {
      medicalRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
      if (!medicalRecord) {
        throw new NotFoundError('Medical record not found for update');
      }
    }

    const estimatedCost = overallMetadata?.totalPageCount
      ? overallMetadata.totalPageCount * 0.0015
      : ocrMetadata?.pageCount
        ? ocrMetadata.pageCount * 0.0015
        : 0.0015;

    let linkedPatientId = null;
    if (patientId) {
      try {
        const ownedPatient = await Patient.findOne({ _id: patientId, userId: req.userId });
        if (ownedPatient) {
          linkedPatientId = ownedPatient._id;
        } else {
          logger.warn({ patientId, userId: req.userId }, 'Patient not found for user');
        }
      } catch (err) {
        logger.warn({ err, patientId }, 'Patient validation failed');
      }
    }

    if (!medicalRecord) {
      medicalRecord = new MedicalRecord({
        userId: req.userId,
        extractedText: text
      });
    }

    const baseOCRInfo = overallMetadata
      ? {
          provider: overallMetadata.providers.join(', '),
          confidence: overallMetadata.averageConfidence,
          processingTime: overallMetadata.totalProcessingTime,
          templateType: 'mixed',
          pageCount: overallMetadata.totalPageCount,
          processedAt: overallMetadata.processedAt ? new Date(overallMetadata.processedAt) : new Date(),
          totalCost: estimatedCost,
          isMultipleFiles: true,
          isFallback: overallMetadata.isFallback,
          pages: undefined
        }
      : (ocrMetadata
          ? {
              provider: ocrMetadata.provider,
              confidence: ocrMetadata.confidence,
              processingTime: ocrMetadata.processingTime,
              templateType: ocrMetadata.templateType,
              pageCount: ocrMetadata.pageCount,
              processedAt: new Date(),
              totalCost: estimatedCost,
              isMultipleFiles: false,
              isFallback: ocrMetadata.isFallback
            }
          : medicalRecord.ocrMetadata);

    const baseArchive = clinicalArchive
      ? mergeArchives(
          medicalRecord.clinicalArchive || createPatientArchive(linkedPatientId || medicalRecord.patientId?.toString?.() || ''),
          clinicalArchive
        )
      : medicalRecord.clinicalArchive;

    Object.assign(medicalRecord, {
      userId: req.userId,
      patientId: linkedPatientId || medicalRecord.patientId || undefined,
      extractedText: text,
      structuredData,
      clinicalArchive: baseArchive,
      originalFileName: fileId || medicalRecord.originalFileName || 'uploaded_file',
      multipleFiles: results
        ? {
            fileCount: results.length,
            fileDetails: results.map((r) => ({
              fileName: r.fileName,
              fileId: r.fileId,
              confidence: r.ocrMetadata.confidence,
              pageCount: r.ocrMetadata.pageCount
            }))
          }
        : medicalRecord.multipleFiles || null,
      llmIntegrationData: llmIntegrationData
        ? {
            ...llmIntegrationData,
            metadata: {
              ...(llmIntegrationData.metadata || {}),
              documentClassification: docClassification,
              extractionEvidence,
              extractionWarnings,
              dataQuality,
              updatedAt: new Date()
            }
          }
        : {
            correctedText: null,
            fullStructuredData: null,
            timeline: null,
            metadata: {
              documentClassification: docClassification,
              extractedBy: useLLM ? 'llm' : 'rules',
              extractionEvidence,
              extractionWarnings,
              dataQuality,
              updatedAt: new Date()
            }
          },
      ocrMetadata: baseOCRInfo
    });

    if (baseArchive) {
      medicalRecord.markModified('clinicalArchive');
    }

    await medicalRecord.save();
    await cacheService.del(`records:${req.userId}`);
    if (medicalRecord._id) {
      await cacheService.flushByPrefix(`match:classic:${medicalRecord._id}`);
      await cacheService.flushByPrefix(`match:llm:${medicalRecord._id}`);
    }

    if (linkedPatientId) {
      await Patient.findByIdAndUpdate(linkedPatientId, {
        latestRecordId: medicalRecord._id,
        latestStructuredData: structuredData,
        latestClinicalArchive: baseArchive,
        $currentDate: { updatedAt: true }
      }).catch((err) => logger.warn({ err, patientId: linkedPatientId }, 'Failed to update patient latest record'));
    }

    return res.success({
      structuredData,
      clinicalArchive: baseArchive,
      recordId: medicalRecord._id,
      patientId: linkedPatientId || null,
      usedLLM: useLLM,
      documentClassification: docClassification,
      dataQuality,
      extractionEvidence,
      extractionWarnings,
      llmResult: llmIntegrationData
        ? {
            correctedText: llmIntegrationData.correctedText,
            timeline: llmIntegrationData.timeline,
            processingInfo: {
              provider: llmIntegrationData.metadata?.provider,
              model: llmIntegrationData.metadata?.model,
              processingTime: llmIntegrationData.metadata?.processingTime,
              tokens: llmIntegrationData.metadata?.totalTokens
            }
          }
        : null,
      ocrInfo: overallMetadata
        ? {
            providers: overallMetadata.providers,
            averageConfidence: overallMetadata.averageConfidence,
            totalPageCount: overallMetadata.totalPageCount,
            totalProcessingTime: overallMetadata.totalProcessingTime,
            estimatedCost,
            fileCount: results ? results.length : 1,
            isFallback: overallMetadata.isFallback
          }
        : (ocrMetadata
            ? {
                provider: ocrMetadata.provider,
                confidence: ocrMetadata.confidence,
                pageCount: ocrMetadata.pageCount,
                estimatedCost,
                fileCount: 1,
                isFallback: ocrMetadata.isFallback
              }
            : null)
    }, { message: 'Text parsed successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function extractFieldsWithLLM(req, res, next) {
  try {
    const payload = fieldExtractionSchema.parse(req.body);
    const { text, fields, recordId } = payload;

    logger.info({ userId: req.userId, hasRecord: Boolean(recordId) }, 'Extracting fields with Moonshot');

    const extraction = await llmService.extractMedicalFields(text, fields);
    const normalizedStructured = normalizeStructuredData(extraction.structuredData || {});

    let updatedRecord = null;

    if (recordId) {
      const medicalRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
      if (!medicalRecord) {
        logger.warn({ recordId, userId: req.userId }, 'Medical record not found for field extraction update');
      } else {
        const mergedStructured = mergeStructuredRecords(medicalRecord.structuredData || {}, normalizedStructured);
        medicalRecord.structuredData = normalizeStructuredData(mergedStructured);
        if (!medicalRecord.extractedText) {
          medicalRecord.extractedText = text;
        }

        const existingIntegration = medicalRecord.llmIntegrationData || {};
        medicalRecord.llmIntegrationData = {
          ...existingIntegration,
          fieldExtraction: {
            entries: extraction.entries,
            metadata: extraction.metadata,
            updatedAt: new Date()
          }
        };

        await medicalRecord.save();
        updatedRecord = {
          id: medicalRecord._id,
          structuredData: medicalRecord.structuredData
        };

        await cacheService.del(`records:${req.userId}`);
        await refreshPatientLatestData(medicalRecord.patientId, req.userId);
      }
    }

    const status = extraction.success ? 200 : 206;
    const message = extraction.success ? 'Field extraction completed' : 'Field extraction completed with warnings';

    return res.success({
      success: extraction.success,
      entries: extraction.entries,
      structuredData: normalizedStructured,
      metadata: extraction.metadata,
      record: updatedRecord
    }, { status, message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function integrateMedicalRecord(req, res, next) {
  try {
    const llmService = defaultContainer.deps.llmService;
    const { text, recordId } = req.body || {};
    if (!text) {
      throw new BadRequestError('没有提供文本内容');
    }

    logger.info({ userId: req.userId, hasRecordId: Boolean(recordId) }, '开始整合病历信息');

    // If recordId is provided, validate ownership first to avoid leaking LLM calls/costs to attackers.
    let ownedRecord = null;
    if (recordId) {
      if (!mongoose.isValidObjectId(recordId)) {
        throw new BadRequestError('Invalid medical record identifier');
      }
      ownedRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
      if (!ownedRecord) {
        throw new NotFoundError('Medical record not found');
      }
    }

    const integrationResult = await llmService.integrateMedicalRecord(text);

    if (!integrationResult.success) {
      throw new HttpError(502, 'LLM 整合失败', {
        code: 'llm_integration_failed',
        details: integrationResult.error || 'unknown'
      });
    }

    let clinicalArchive = integrationResult.clinicalArchive || null;
    if (ownedRecord) {
      const record = ownedRecord;

      const existingArchive = record.clinicalArchive || createPatientArchive(record.patientId?.toString?.() || recordId);
      clinicalArchive = mergeArchives(existingArchive, integrationResult.clinicalArchive);

      record.llmIntegrationData = {
        correctedText: integrationResult.correctedText,
        fullStructuredData: integrationResult.structuredData,
        timeline: integrationResult.timeline,
        metadata: integrationResult.metadata
      };
      record.clinicalArchive = clinicalArchive;
      record.markModified('clinicalArchive');
      await record.save();

      await refreshPatientLatestData(record.patientId, req.userId);
    }

    return res.success({
      correctedText: integrationResult.correctedText,
      structuredData: integrationResult.structuredData,
      clinicalArchive,
      timeline: integrationResult.timeline,
      metadata: integrationResult.metadata
    }, { message: '病历整合成功' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  parseMedicalText,
  extractFieldsWithLLM,
  integrateMedicalRecord
};
