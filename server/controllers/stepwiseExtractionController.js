const mongoose = require('mongoose');

const { MedicalRecord, Patient } = require('../models');
const logger = require('../utils/logger');
const { HttpError, BadRequestError, NotFoundError } = require('../utils/httpError');
const { defaultContainer } = require('../services/ServiceContainer');

const stepwiseLLMService = defaultContainer.deps.stepwiseLLMService;

/**
 * 启动分步医疗数据提取
 */
async function startStepwiseExtraction(req, res, next) {
  const { text, patientId, recordId } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new BadRequestError('病历文本不能为空');
  }

  let linkedRecordId = null;
  let seedArchive = null;
  let resolvedPatientId = patientId;

  if (recordId) {
    if (!mongoose.isValidObjectId(recordId)) {
      throw new BadRequestError('无效的病历记录 ID');
    }

    const medicalRecord = await MedicalRecord.findOne({ _id: recordId, userId: req.user.userId });
    if (!medicalRecord) {
      throw new NotFoundError('未找到对应的病历记录');
    }

    linkedRecordId = medicalRecord._id.toString();
    seedArchive = medicalRecord.clinicalArchive || null;

    if (patientId && medicalRecord.patientId && String(medicalRecord.patientId) !== String(patientId)) {
      throw new BadRequestError('patientId 与 recordId 不匹配');
    }

    if (!resolvedPatientId && medicalRecord.patientId) {
      resolvedPatientId = medicalRecord.patientId.toString();
    }
  }

  if (resolvedPatientId) {
    if (!mongoose.isValidObjectId(resolvedPatientId)) {
      throw new BadRequestError('无效的患者 ID');
    }

    const patient = await Patient.findOne({ _id: resolvedPatientId, userId: req.user.userId }).select('_id');
    if (!patient) {
      throw new NotFoundError('未找到对应的患者');
    }

    resolvedPatientId = patient._id.toString();
  }

  logger.info({
    traceId: req.id,
    userId: req.user.userId,
    patientId: resolvedPatientId,
    recordId: linkedRecordId,
    textLength: text.length
  }, '启动分步医疗数据提取');

  try {
    const result = await stepwiseLLMService.startStepwiseExtraction(text, resolvedPatientId, {
      recordId: linkedRecordId,
      userId: req.user.userId,
      seedArchive
    });

    res.json({
      success: true,
      data: result,
      message: '分步提取任务已启动'
    });
  } catch (error) {
    logger.error({ err: error, traceId: req.id, userId: req.user.userId }, '启动分步提取失败');
    return next(new HttpError(500, '启动分步提取失败', error.message));
  }
}

/**
 * 获取分步提取任务状态
 */
async function getExtractionStatus(req, res) {
  const { jobId } = req.params;

  if (!jobId) {
    throw new BadRequestError('任务ID不能为空');
  }

  try {
    const status = await stepwiseLLMService.getExtractionStatus(jobId, req.user.userId);

    if (status.error) {
      throw new NotFoundError('提取任务不存在');
    }

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    logger.error({ err: error, traceId: req.id, jobId, userId: req.user.userId }, '获取提取状态失败');
    throw new HttpError(500, '获取提取状态失败', error.message);
  }
}

/**
 * 获取分步提取最终结果
 */
async function getExtractionResult(req, res) {
  const { jobId } = req.params;

  if (!jobId) {
    throw new BadRequestError('任务ID不能为空');
  }

  try {
    const result = await stepwiseLLMService.getStructuredResult(jobId, req.user.userId);

    if (!result) {
      const status = await stepwiseLLMService.getExtractionStatus(jobId, req.user.userId);
      if (status.error) {
        throw new NotFoundError('提取任务不存在');
      } else if (status.status !== 'completed') {
        throw new BadRequestError(`提取任务尚未完成，当前状态: ${status.status}`);
      } else {
        throw new HttpError(500, '无法获取提取结果');
      }
    }

    logger.info({
      traceId: req.id,
      jobId,
      userId: req.user.userId,
      confidence: result.extractionMetadata.confidence,
      successfulSteps: result.extractionMetadata.successfulSteps
    }, '分步提取结果获取成功');

    res.json({
      success: true,
      data: result,
      message: '提取结果获取成功'
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    logger.error({ err: error, traceId: req.id, jobId, userId: req.user.userId }, '获取提取结果失败');
    throw new HttpError(500, '获取提取结果失败', error.message);
  }
}

module.exports = {
  startStepwiseExtraction,
  getExtractionStatus,
  getExtractionResult
};
