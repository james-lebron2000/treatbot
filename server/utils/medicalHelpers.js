/*
 * =====================================================
 * Medical Helpers - 医疗相关共享工具函数
 * =====================================================
 * 职责：提供控制器间共享的工具函数
 * 设计原则：消除代码重复，提升可维护性
 * =====================================================
 */

const { Patient, MedicalRecord } = require('../models');
const logger = require('./logger');

// ========================================
// OCR 模板选择
// ========================================
const TEMPLATE_KEYWORDS = ['医疗', '病历', '检查'];

function selectOCRTemplate(fileName = '') {
  const lower = fileName.toLowerCase();
  return TEMPLATE_KEYWORDS.some((kw) => lower.includes(kw)) ? 'medical' : 'general';
}

// ========================================
// 临床档案格式判断
// ========================================
function isClinicalArchiveFormat(structuredData) {
  if (!structuredData || typeof structuredData !== 'object') return false;
  return Boolean(
    structuredData.basic_info &&
    structuredData.medical_history &&
    structuredData.lab_results
  );
}

// ========================================
// 刷新患者最新数据
// ========================================
async function refreshPatientLatestData(patientId, userId) {
  if (!patientId) return;

  try {
    const latestRecord = await MedicalRecord.findOne({ patientId, userId })
      .sort({ uploadDate: -1 });

    if (latestRecord) {
      await Patient.findOneAndUpdate({ _id: patientId, userId }, {
        latestRecordId: latestRecord._id,
        latestStructuredData: latestRecord.structuredData,
        latestClinicalArchive: latestRecord.clinicalArchive,
        $currentDate: { updatedAt: true }
      });
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'Failed to refresh patient latest data');
  }
}

// ========================================
// 成本估算
// ========================================
function calculateOCRCost(pageCount) {
  return pageCount * 0.0015; // $0.0015 per page
}

// ========================================
// 构建 OCR 元数据
// ========================================
function buildOCRMetadata(ocrMetadata, overallMetadata) {
  const pageCount = overallMetadata?.totalPageCount || ocrMetadata?.pageCount || 1;
  const estimatedCost = calculateOCRCost(pageCount);

  if (overallMetadata) {
    return {
      provider: overallMetadata.providers.join(', '),
      confidence: overallMetadata.averageConfidence,
      processingTime: overallMetadata.totalProcessingTime,
      templateType: 'mixed',
      pageCount: overallMetadata.totalPageCount,
      processedAt: overallMetadata.processedAt ? new Date(overallMetadata.processedAt) : new Date(),
      totalCost: estimatedCost,
      isMultipleFiles: true,
      isFallback: overallMetadata.isFallback
    };
  }

  if (ocrMetadata) {
    return {
      provider: ocrMetadata.provider,
      confidence: ocrMetadata.confidence,
      processingTime: ocrMetadata.processingTime,
      templateType: ocrMetadata.templateType,
      pageCount: ocrMetadata.pageCount,
      processedAt: new Date(),
      totalCost: estimatedCost,
      isMultipleFiles: false,
      isFallback: ocrMetadata.isFallback
    };
  }

  return null;
}

// ========================================
// 验证患者所有权
// ========================================
async function validatePatientOwnership(patientId, userId) {
  if (!patientId) return null;

  try {
    const patient = await Patient.findOne({ _id: patientId, userId });
    if (patient) {
      return patient._id;
    } else {
      logger.warn({ patientId, userId }, 'Patient not found or not owned by user');
      return null;
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'Patient validation failed');
    return null;
  }
}

// ========================================
// 导出
// ========================================
module.exports = {
  selectOCRTemplate,
  isClinicalArchiveFormat,
  refreshPatientLatestData,
  calculateOCRCost,
  buildOCRMetadata,
  validatePatientOwnership
};
