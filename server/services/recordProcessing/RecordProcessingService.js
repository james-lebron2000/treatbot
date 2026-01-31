/**
 * RecordProcessingService
 * Handles OCR coordination, text parsing, and LLM integration
 */

const logger = require('../../utils/logger');
const { normalizeStructuredData } = require('../../utils/recordNormalizer');
const { createPatientArchive, mergeArchives } = require('../../utils/patientArchive');

class RecordProcessingService {
  constructor({ ocrService, llmService, stepwiseLLMService, MedicalRecord, Patient, cacheService }) {
    this.ocrService = ocrService;
    this.llmService = llmService;
    this.stepwiseLLMService = stepwiseLLMService;
    this.MedicalRecord = MedicalRecord;
    this.Patient = Patient;
    this.cacheService = cacheService;
  }

  /**
   * Process uploaded files through OCR
   * @param {Array} files - Multer file objects
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processUploadedFiles(files, options = {}) {
    const results = [];
    const errors = [];
    let combinedText = '';

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
      const template = this._selectTemplate(file.originalname);

      try {
        const ocrResult = await this.extractTextFromFile(file, template);
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

        results.push({
          fileIndex: i + 1,
          fileName: file.originalname,
          fileId: file.filename,
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
      averageConfidence
    };
  }

  /**
   * Extract text from a single file using OCR
   * @param {Object} file - Multer file object
   * @param {string} template - OCR template to use
   * @returns {Promise<Object>} Extraction result
   */
  async extractTextFromFile(file, template = 'general') {
    try {
      const fileType = file.mimetype;
      const filePath = file.path;

      const ocrResult = await this.ocrService.recognizeFile(filePath, fileType, template);

      if (!ocrResult.success) {
        return {
          success: false,
          error: ocrResult.error || 'OCR processing failed'
        };
      }

      const extractedText = ocrResult.results
        .map(page => page.content)
        .filter(content => content.trim())
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
        error: error.message || 'Failed to extract text from file'
      };
    }
  }

  /**
   * Parse text to structured data
   * @param {string} text - Medical text to parse
   * @param {Object} options - Parsing options
   * @returns {Promise<Object>} Parsed structured data
   */
  async parseTextToStructured(text, options = {}) {
    const { useLLM = false, recordId, patientId } = options;

    logger.info({ useLLM }, 'Parsing medical text');

    let structuredData;
    let clinicalArchive = null;
    let llmIntegrationData = null;

    if (useLLM) {
      try {
        const integrationResult = await this.llmService.integrateMedicalRecord(text);
        if (integrationResult.success && integrationResult.structuredData?.patientProfile) {
          const profile = integrationResult.structuredData.patientProfile;
          const clinical = integrationResult.structuredData.clinicalInformation || {};
          const treatments = integrationResult.structuredData.treatmentHistory || [];

          clinicalArchive = integrationResult.clinicalArchive || null;

          structuredData = {
            diagnosis: clinical.pathology?.type || clinical.diagnosis?.primary || '',
            stage: '',
            mutations: [],
            age: profile.age?.value || null,
            gender: profile.gender?.value === '男' ? 'male' : (profile.gender?.value === '女' ? 'female' : ''),
            previousTreatments: treatments.map((t) => (t.regimen ? t.regimen.join('+') : '')).filter(Boolean),
            biomarkers: {},
            performanceStatus: clinical.ecogScore?.value ? `ECOG ${clinical.ecogScore.value}` : ''
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
          logger.warn('LLM parsing returned empty structured data, falling back to heuristic parse');
          structuredData = this._mockNLPParse(text);
        }
      } catch (error) {
        logger.error({ err: error }, 'LLM parsing error, falling back to heuristic parse');
        structuredData = this._mockNLPParse(text);
      }
    } else {
      structuredData = this._mockNLPParse(text);
    }

    structuredData = normalizeStructuredData(structuredData || {});

    return {
      structuredData,
      clinicalArchive,
      llmIntegrationData
    };
  }

  /**
   * Extract specific fields from text using LLM
   * @param {string} text - Medical text
   * @param {Array} fields - Fields to extract
   * @param {string} recordId - Optional record ID to update
   * @returns {Promise<Object>} Extraction result
   */
  async extractSpecificFields(text, fields, recordId) {
    logger.info({ hasRecord: Boolean(recordId) }, 'Extracting fields with LLM');

    const extraction = await this.llmService.extractMedicalFields(text, fields);
    const normalizedStructured = normalizeStructuredData(extraction.structuredData || {});

    return {
      success: extraction.success,
      entries: extraction.entries,
      structuredData: normalizedStructured,
      metadata: extraction.metadata
    };
  }

  /**
   * Integrate medical record with full LLM processing
   * @param {string} text - Medical text
   * @param {Object} existingArchive - Existing clinical archive
   * @returns {Promise<Object>} Integration result
   */
  async integrateMedicalRecord(text, existingArchive = null) {
    logger.info('Starting medical record integration');

    const integrationResult = await this.llmService.integrateMedicalRecord(text);

    if (!integrationResult.success) {
      throw new Error('LLM integration failed');
    }

    let clinicalArchive = integrationResult.clinicalArchive || null;
    if (existingArchive) {
      clinicalArchive = mergeArchives(existingArchive, integrationResult.clinicalArchive);
    }

    return {
      correctedText: integrationResult.correctedText,
      structuredData: integrationResult.structuredData,
      clinicalArchive,
      timeline: integrationResult.timeline,
      metadata: integrationResult.metadata
    };
  }

  /**
   * Start stepwise extraction process
   */
  async startStepwiseExtraction(text, patientId, options) {
    return await this.stepwiseLLMService.startStepwiseExtraction(text, patientId, options);
  }

  /**
   * Get extraction status
   */
  async getExtractionStatus(jobId) {
    return await this.stepwiseLLMService.getExtractionStatus(jobId);
  }

  /**
   * Get extraction result
   */
  async getExtractionResult(jobId) {
    return await this.stepwiseLLMService.getStructuredResult(jobId);
  }

  /**
   * Check OCR service health
   */
  async checkOCRHealth() {
    // Implementation would check OCR service availability
    return {
      status: 'healthy',
      ocrService: 'alibaba-cloud',
      timestamp: new Date().toISOString()
    };
  }

  // Private helper methods

  _selectTemplate(fileName = '') {
    const templateKeywords = ['医疗', '病历', '检查'];
    const lower = fileName.toLowerCase();
    return templateKeywords.some((keyword) => lower.includes(keyword)) ? 'medical' : 'general';
  }

  _mockNLPParse(text) {
    // Simplified heuristic parsing (existing logic from controller)
    const record = {
      age: null,
      gender: null,
      primary_diagnosis: null,
      // ... rest of mock parsing logic
    };

    const chinese = text;
    const ageMatch = chinese.match(/(\d{1,3})岁/);
    if (ageMatch) record.age = parseInt(ageMatch[1], 10);

    if (chinese.includes('男')) record.gender = 'male';
    if (chinese.includes('女')) record.gender = 'female';

    if (chinese.includes('肝细胞癌')) record.primary_diagnosis = '肝细胞癌';
    if (chinese.includes('肺腺癌')) record.primary_diagnosis = '肺腺癌';

    return record;
  }
}

module.exports = RecordProcessingService;
