const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const axios = require('axios');

const FileMetadata = require('../models/FileMetadata');
const fileStorageService = require('../services/storage/FileStorageService');

const { defaultContainer } = require('../services/ServiceContainer');

const { MedicalRecord, Patient } = require('../models');
const config = require('../config');
const cacheService = require('../services/cache');
const logger = require('../utils/logger');
const { HttpError, BadRequestError } = require('../utils/httpError');
const { selectOCRTemplate } = require('../utils/medicalHelpers');
const { recordMatchBatchMetrics } = require('../monitoring/metrics');

const { ocrRecordSchema } = require('./medicalSchemas');

const ocrService = defaultContainer.deps.ocrService;

function resolveDefaultRetention() {
  const value = String(process.env.FILE_RETENTION_DEFAULT || '').trim();
  if (!value) return undefined;
  const allowed = new Set(['1year', '3years', '7years', 'permanent']);
  return allowed.has(value) ? value : undefined;
}

async function cleanupUpload(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    logger.warn({ filePath, err }, 'Failed to cleanup upload');
  }
}

/**
 * Extract text from uploaded file using OCR service
 * @param {Object} file - Multer file object
 * @param {string} template - OCR template to use
 * @returns {Promise<Object>} OCR result with extracted text and metadata
 */
async function extractTextFromFile(file, template = 'general') {
  try {
    const fileType = file.mimetype;
    const filePath = file.path;

    const ocrResult = await ocrService.recognizeFile(filePath, fileType, template);

    if (!ocrResult.success) {
      return {
        success: false,
        error: ocrResult.error || 'OCR 处理失败'
      };
    }

    const extractedText = ocrResult.results
      .map((page) => page.content)
      .filter((content) => content.trim())
      .join('\n');

    return {
      success: true,
      extractedText,
      metadata: {
        confidence: ocrResult.averageConfidence,
        processingTime: ocrResult.processingTime,
        pageCount: ocrResult.totalPages,
        provider: ocrResult.provider || 'alibaba-ocr',
        isFallback: ocrResult.isFallback || false
      }
    };
  } catch (error) {
    logger.error({ fileName: file.originalname, err: error }, 'OCR extraction failed');
    return {
      success: false,
      error: error.message || '文件文字提取失败'
    };
  }
}

async function resolveUploadPatientId({ userId, patientId }) {
  if (patientId) {
    return patientId;
  }

  const uploadsConfig = config.uploads || {};
  const requirePatientId = uploadsConfig.requirePatientId === true;
  const allowFallback = uploadsConfig.legacyFallback !== false;

  if (requirePatientId || !allowFallback) {
    throw new BadRequestError('缺少患者标识，无法上传');
  }

  const fallbackTag = 'legacy-upload';

  let fallbackPatient = await Patient.findOne({ userId, tags: fallbackTag }).sort({ updatedAt: -1 });
  if (!fallbackPatient) {
    const generatedPatientId = `LEGACY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    fallbackPatient = await Patient.create({
      userId,
      patientId: generatedPatientId,
      name: 'Legacy Upload',
      gender: 'other',
      notes: 'Auto-created for uploads missing patientId',
      tags: [fallbackTag]
    });
    logger.warn({ userId, fallbackPatientId: fallbackPatient._id.toString() }, 'Created legacy patient for upload without patientId');
  } else {
    logger.warn({ userId, fallbackPatientId: fallbackPatient._id.toString() }, 'Upload missing patientId, using legacy fallback patient');
  }

  return fallbackPatient._id.toString();
}

async function processUploads(files, options = {}) {
  const { userId } = options;

  if (!userId) {
    throw new BadRequestError('缺少用户信息，无法上传');
  }

  const resolvedPatientId = await resolveUploadPatientId(options);

  const results = [];
  const errors = [];
  let combinedText = '';
  const retention = resolveDefaultRetention();

  const stats = {
    successCount: 0,
    failCount: 0,
    providers: new Set(),
    totalProcessingTime: 0,
    totalPageCount: 0,
    confidenceSum: 0,
    fallbackDetected: false
  };

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const template = selectOCRTemplate(file.originalname);
    let storageInfo = null;
    let fileMetadataDoc = null;

    try {
      const ocrResult = await extractTextFromFile(file, template);
      if (!ocrResult.success) {
        throw new Error(ocrResult.error || 'OCR failed');
      }

      const { extractedText, metadata } = ocrResult;
      stats.successCount += 1;
      stats.totalProcessingTime += metadata.processingTime || 0;
      stats.totalPageCount += metadata.pageCount || 0;
      stats.confidenceSum += metadata.confidence || 0;
      stats.providers.add(metadata.provider);
      stats.fallbackDetected = stats.fallbackDetected || !!metadata.isFallback;

      if (extractedText) {
        combinedText += files.length > 1
          ? `\n\n=== ${file.originalname} ===\n${extractedText}`
          : extractedText;
      }

      storageInfo = await fileStorageService.storeFile(file, {
        userId: userId.toString(),
        patientId: resolvedPatientId.toString(),
        originalName: file.originalname
      });

      if (storageInfo && storageInfo.constructor && storageInfo.constructor.modelName === 'FileMetadata') {
        fileMetadataDoc = storageInfo;
        await fileMetadataDoc.addVersion({
          extractedText,
          ocrMetadata: metadata,
          structuredData: {},
          fileSize: file.size,
          checksum: fileMetadataDoc.checksum
        });
      } else {
        fileMetadataDoc = await FileMetadata.create({
          userId,
          patientId: resolvedPatientId,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          storagePath: storageInfo.storagePath,
          checksum: storageInfo.checksum,
          ...(retention ? { retention } : {}),
          versions: [{
            extractedText,
            ocrMetadata: metadata,
            structuredData: {},
            fileSize: file.size,
            checksum: storageInfo.checksum
          }],
          currentVersion: 0,
          backupStatus: {
            local: true,
            cloud: false,
            lastBackup: null,
            backupAttempts: 0,
            lastBackupError: null
          }
        });
      }

      results.push({
        fileIndex: i + 1,
        fileName: file.originalname,
        fileId: fileMetadataDoc._id.toString(),
        extractedText,
        ocrMetadata: metadata
      });
    } catch (error) {
      stats.failCount += 1;
      errors.push({
        fileIndex: i + 1,
        fileName: file.originalname,
        fileId: file.filename,
        error: error.message
      });
      logger.error({ fileName: file.originalname, err: error }, 'Processing failed for file');
      if (storageInfo && !(storageInfo.constructor && storageInfo.constructor.modelName === 'FileMetadata')) {
        try {
          await fileStorageService.deleteFile(storageInfo.storagePath, { permanent: true, keepBackup: false });
        } catch (cleanupError) {
          logger.warn({ cleanupError, storagePath: storageInfo.storagePath }, 'Failed to cleanup stored file after error');
        }
      }
    } finally {
      const returnedExistingDoc = storageInfo && storageInfo.constructor && storageInfo.constructor.modelName === 'FileMetadata';
      if (!storageInfo || returnedExistingDoc) {
        await cleanupUpload(file.path);
      }
    }
  }

  const averageConfidence = stats.successCount
    ? Math.round(stats.confidenceSum / stats.successCount)
    : 0;

  const overallMetadata = stats.successCount > 1 ? {
    providers: Array.from(stats.providers),
    averageConfidence,
    totalProcessingTime: stats.totalProcessingTime,
    totalPageCount: stats.totalPageCount,
    processedAt: new Date(),
    isFallback: stats.fallbackDetected
  } : undefined;

  return {
    results,
    errors,
    combinedText: combinedText.trim(),
    stats,
    overallMetadata,
    averageConfidence,
    patientId: resolvedPatientId,
    usedFallback: !options.patientId
  };
}

async function uploadMedicalFiles(req, res, next) {
  if (!req.files || req.files.length === 0) {
    return next(new BadRequestError('没有上传文件'));
  }

  try {
    const {
      results,
      errors,
      combinedText,
      stats,
      overallMetadata,
      averageConfidence,
      patientId: resolvedPatientId,
      usedFallback
    } = await processUploads(req.files, {
      userId: req.userId,
      patientId: req.body?.patientId
    });

    if (req.files.length === 1) {
      const [result] = results;
      if (!result) {
        const [error] = errors;
        throw new HttpError(502, 'OCR 处理失败', {
          code: 'ocr_failed',
          details: { fileId: error?.fileId, reason: error?.error || 'Unknown error' }
        });
      }

      return res.success({
        fileName: result.fileName,
        extractedText: result.extractedText,
        fileId: result.fileId,
        ocrMetadata: result.ocrMetadata,
        patientId: resolvedPatientId,
        legacyPatientFallback: usedFallback
      }, {
        message: stats.fallbackDetected ? '文件已使用备用 OCR 处理' : '文件上传并处理成功'
      });
    }

    return res.success({
      totalFiles: req.files.length,
      successCount: stats.successCount,
      failCount: stats.failCount,
      combinedText,
      results,
      errors,
      overallMetadata: overallMetadata || {
        providers: Array.from(stats.providers),
        averageConfidence,
        totalProcessingTime: stats.totalProcessingTime,
        totalPageCount: stats.totalPageCount,
        processedAt: new Date().toISOString(),
        isFallback: stats.fallbackDetected
      },
      patientId: resolvedPatientId,
      legacyPatientFallback: usedFallback
    }, {
      message: `成功处理 ${stats.successCount} 个文件，失败 ${stats.failCount} 个`
    });
  } catch (error) {
    recordMatchBatchMetrics({ durationMs: 0, batchSize: 0, status: 'error' });
    return next(error);
  }
}

async function createRecordFromOCR(req, res, next) {
  try {
    const payload = ocrRecordSchema.parse(req.body);
    const {
      text,
      patientId,
      fileId,
      ocrMetadata,
      results,
      overallMetadata
    } = payload;

    let linkedPatientId = null;
    if (patientId) {
      try {
        const ownedPatient = await Patient.findOne({ _id: patientId, userId: req.userId });
        if (ownedPatient) {
          linkedPatientId = ownedPatient._id;
        } else {
          logger.warn({ patientId, userId: req.userId }, 'Patient not found for user when creating OCR record');
        }
      } catch (err) {
        logger.warn({ err, patientId }, 'Patient lookup failed for OCR record');
      }
    }

    const estimatedCost = overallMetadata?.totalPageCount
      ? overallMetadata.totalPageCount * 0.0015
      : ocrMetadata?.pageCount
        ? ocrMetadata.pageCount * 0.0015
        : 0.0015;

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
          isFallback: overallMetadata.isFallback
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
          : undefined);

    const medicalRecord = new MedicalRecord({
      userId: req.userId,
      patientId: linkedPatientId || undefined,
      extractedText: text,
      structuredData: null,
      originalFileName: fileId || 'uploaded_file',
      multipleFiles: results
        ? {
            fileCount: results.length,
            fileDetails: results.map((r) => ({
              fileName: r.fileName,
              fileId: r.fileId || undefined,
              confidence: r.ocrMetadata?.confidence,
              pageCount: r.ocrMetadata?.pageCount
            }))
          }
        : null,
      ocrMetadata: baseOCRInfo || null
    });

    await medicalRecord.save();
    await cacheService.del(`records:${req.userId}`);

    if (linkedPatientId) {
      await Patient.findOneAndUpdate({ _id: linkedPatientId, userId: req.userId }, {
        latestRecordId: medicalRecord._id,
        $currentDate: { updatedAt: true }
      }).catch((err) => logger.warn({ err, patientId: linkedPatientId }, 'Failed to update patient latest record (OCR create)'));
    }

    return res.success({
      recordId: medicalRecord._id,
      patientId: linkedPatientId || null,
      extractedText: medicalRecord.extractedText,
      ocrMetadata: medicalRecord.ocrMetadata,
      multipleFiles: medicalRecord.multipleFiles
    }, { status: 201, message: 'OCR record created' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function ocrHealthCheck(_req, res, next) {
  try {
    // Store uploads under repo root (shared docker volume: /app/uploads), not /server/uploads.
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const hasCredentials = Boolean(process.env.ALIBABA_ACCESS_KEY_ID && process.env.ALIBABA_ACCESS_KEY_SECRET && process.env.ALIBABA_ACCESS_KEY_ID !== 'your_access_key_id');

    const healthCheck = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      ocrService: 'alibaba-cloud',
      configuration: {
        credentialsConfigured: hasCredentials,
        endpoint: process.env.ALIBABA_OCR_ENDPOINT,
        region: process.env.ALIBABA_OCR_REGION,
        accessKeyIdConfigured: !!process.env.ALIBABA_ACCESS_KEY_ID,
        accessKeySecretConfigured: !!process.env.ALIBABA_ACCESS_KEY_SECRET,
        strictMode: Boolean(config.strictMode),
        allowMockFallback: Boolean(config.ocr.allowMockFallback),
        allowTesseractFallback: Boolean(config.ocr.allowTesseractFallback),
        pythonOcrUrl: config.pythonOcrUrl
      },
      dependencies: {
        sharp: 'installed',
        pdfPoppler: 'disabled (Linux compatibility)',
        uploadsDirectory: 'exists',
        pythonOcrService: 'unknown'
      }
    };

    try {
      await fs.access(uploadsDir);
    } catch (err) {
      healthCheck.dependencies.uploadsDirectory = 'missing';
      healthCheck.status = 'degraded';
    }

    if (!hasCredentials) {
      healthCheck.status = config.strictMode ? 'unhealthy' : 'degraded';
      healthCheck.message = config.strictMode
        ? 'OCR credentials missing in strict mode'
        : 'OCR credentials missing; OCR may fail';
    }

    try {
      const startedAt = Date.now();
      const resp = await axios.get(`${config.pythonOcrUrl.replace(/\/$/, '')}/health`, { timeout: 2000 });
      const ok = resp.status === 200 && resp.data && resp.data.success !== false;
      healthCheck.dependencies.pythonOcrService = ok
        ? `ok (${Date.now() - startedAt}ms)`
        : `error (${resp.status})`;
      if (!ok && healthCheck.status === 'healthy') {
        healthCheck.status = config.strictMode ? 'unhealthy' : 'degraded';
      }
    } catch (err) {
      healthCheck.dependencies.pythonOcrService = `error (${err.code || err.message})`;
      if (healthCheck.status === 'healthy') {
        healthCheck.status = config.strictMode ? 'unhealthy' : 'degraded';
      }
    }

    return res.success(healthCheck, { message: 'OCR health check complete' });
  } catch (error) {
    logger.error({ err: error }, 'OCR health check failed');
    return next(error);
  }
}

module.exports = {
  uploadMedicalFiles,
  createRecordFromOCR,
  ocrHealthCheck
};
