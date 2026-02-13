/**
 * =============================================================================
 * 上传进度API路由
 * Upload Progress API Routes
 * =============================================================================
 * Linus哲学：API设计要像C语言一样简洁明了
 * Good taste: API design should be as clear as C language
 * =============================================================================
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { uploadProgressService } = require('../services/uploadProgressService');
const { authenticateToken } = require('../middleware/auth');
const { HttpError, BadRequestError, NotFoundError } = require('../utils/httpError');
const logger = require('../utils/logger');

const requireAuth = authenticateToken;

// =============================================================================
// 验证模式 / Validation Schemas
// =============================================================================

const uploadIdSchema = z.string().min(1).max(100);

const createProgressSchema = z.object({
  uploadId: z.string().min(1).max(100),
  fileName: z.string().optional(),
  fileSize: z.number().int().min(0).optional(),
  patientId: z.string().optional(),
  recordId: z.string().optional()
});

const updateProgressSchema = z.object({
  progress: z.number().min(0).max(100).optional(),
  status: z.enum(['idle', 'uploading', 'processing', 'completed', 'error', 'cancelled']).optional(),
  stage: z.enum(['ocr', 'parsing', 'matching', 'complete']).optional(),
  stageProgress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  estimatedTime: z.number().int().min(0).optional()
});

// =============================================================================
// 中间件 / Middleware
// =============================================================================

/**
 * 验证上传ID参数 / Validate upload ID parameter
 */
function validateUploadId(req, res, next) {
  try {
    const { uploadId } = req.params;
    uploadIdSchema.parse(uploadId);
    next();
  } catch (error) {
    next(new BadRequestError('Invalid upload ID parameter'));
  }
}

/**
 * 验证用户权限 / Validate user permission
 */
function validateUploadOwnership(req, res, next) {
  const { uploadId } = req.params;
  const task = uploadProgressService.getUploadStatus(uploadId);

  if (!task) {
    return next(new NotFoundError('Upload task not found'));
  }

  // 检查用户权限 / Check user permission
  if (task.userId && task.userId !== req.userId) {
    return next(new HttpError(403, 'Access denied to this upload task'));
  }

  req.uploadTask = task;
  next();
}

// =============================================================================
// API路由 / API Routes
// =============================================================================

/**
 * 创建上传进度任务 / Create upload progress task
 * POST /api/upload-progress
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const validation = createProgressSchema.safeParse(req.body);
    if (!validation.success) {
      throw new BadRequestError('Invalid request data', {
        details: validation.error.issues
      });
    }

    const { uploadId, fileName, fileSize, patientId, recordId } = validation.data;

    // 创建上传任务 / Create upload task
    const task = uploadProgressService.createUploadTask(
      uploadId,
      { originalName: fileName, size: fileSize },
      req.userId
    );

    logger.info({
      uploadId,
      userId: req.userId,
      fileName,
      fileSize,
      patientId,
      recordId
    }, 'Upload progress task created');

    res.success(task, {
      message: 'Upload progress task created successfully',
      status: 201
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取上传进度 / Get upload progress
 * GET /api/upload-progress/:uploadId
 */
router.get('/:uploadId', requireAuth, validateUploadId, validateUploadOwnership, (req, res, next) => {
  try {
    const { uploadId } = req.params;
    const task = req.uploadTask;

    res.success(task, {
      message: 'Upload progress retrieved successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 更新上传进度 / Update upload progress
 * PATCH /api/upload-progress/:uploadId
 */
router.patch('/:uploadId', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;
    const validation = updateProgressSchema.safeParse(req.body);

    if (!validation.success) {
      throw new BadRequestError('Invalid update data', {
        details: validation.error.issues
      });
    }

    const updatedTask = uploadProgressService.updateProgress(uploadId, validation.data);

    if (!updatedTask) {
      throw new NotFoundError('Upload task not found');
    }

    logger.info({
      uploadId,
      userId: req.userId,
      updates: validation.data
    }, 'Upload progress updated');

    res.success(updatedTask, {
      message: 'Upload progress updated successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 开始处理阶段 / Start processing stage
 * POST /api/upload-progress/:uploadId/stage
 */
router.post('/:uploadId/stage', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;
    const { stage, message } = req.body;

    if (!stage || !['ocr', 'parsing', 'matching', 'complete'].includes(stage)) {
      throw new BadRequestError('Invalid or missing stage parameter');
    }

    const updatedTask = uploadProgressService.startStage(uploadId, stage, message);

    if (!updatedTask) {
      throw new NotFoundError('Upload task not found');
    }

    logger.info({
      uploadId,
      userId: req.userId,
      stage,
      message
    }, 'Processing stage started');

    res.success(updatedTask, {
      message: `Processing stage '${stage}' started successfully`
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 更新阶段进度 / Update stage progress
 * PATCH /api/upload-progress/:uploadId/stage
 */
router.patch('/:uploadId/stage', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;
    const { stageProgress, message } = req.body;

    if (typeof stageProgress !== 'number' || stageProgress < 0 || stageProgress > 100) {
      throw new BadRequestError('Stage progress must be a number between 0 and 100');
    }

    const updatedTask = uploadProgressService.updateStageProgress(uploadId, stageProgress, message);

    if (!updatedTask) {
      throw new NotFoundError('Upload task not found');
    }

    res.success(updatedTask, {
      message: 'Stage progress updated successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 完成上传任务 / Complete upload task
 * POST /api/upload-progress/:uploadId/complete
 */
router.post('/:uploadId/complete', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;
    const { result } = req.body;

    const completedTask = uploadProgressService.completeUpload(uploadId, result);

    if (!completedTask) {
      throw new NotFoundError('Upload task not found');
    }

    res.success(completedTask, {
      message: 'Upload task completed successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 失败上传任务 / Fail upload task
 * POST /api/upload-progress/:uploadId/fail
 */
router.post('/:uploadId/fail', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;
    const { error, retryable = true } = req.body;

    if (!error) {
      throw new BadRequestError('Error message is required');
    }

    const failedTask = uploadProgressService.failUpload(uploadId, error, retryable);

    if (!failedTask) {
      throw new NotFoundError('Upload task not found');
    }

    res.success(failedTask, {
      message: 'Upload task marked as failed'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 取消上传任务 / Cancel upload task
 * POST /api/upload-progress/:uploadId/cancel
 */
router.post('/:uploadId/cancel', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;

    const cancelledTask = uploadProgressService.cancelUpload(uploadId);

    if (!cancelledTask) {
      throw new NotFoundError('Upload task not found');
    }

    res.success(cancelledTask, {
      message: 'Upload task cancelled successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取用户的所有活跃上传 / Get all active uploads for user
 * GET /api/upload-progress/user/active
 */
router.get('/user/active', requireAuth, (req, res, next) => {
  try {
    const userUploads = uploadProgressService.getUserUploads(req.userId);

    res.success({ uploads: userUploads }, {
      message: 'User active uploads retrieved successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取所有上传任务(管理员) / Get all upload tasks (admin)
 * GET /api/upload-progress/all
 */
router.get('/all', requireAuth, async (req, res, next) => {
  try {
    // 检查管理员权限 / Check admin permission
    if (req.userRole !== 'admin') {
      throw new HttpError(403, 'Admin access required');
    }

    const allUploads = uploadProgressService.getAllUploads();
    const statistics = uploadProgressService.getStatistics();

    res.success({
      uploads: allUploads,
      statistics
    }, {
      message: 'All upload tasks retrieved successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取服务状态 / Get service status
 * GET /api/upload-progress/status
 */
router.get('/status', (req, res, next) => {
  try {
    const healthStatus = uploadProgressService.getHealthStatus();

    res.success(healthStatus, {
      message: 'Upload progress service status retrieved successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取服务统计 / Get service statistics
 * GET /api/upload-progress/statistics
 */
router.get('/statistics', requireAuth, async (req, res, next) => {
  try {
    // 检查管理员权限 / Check admin permission
    if (req.userRole !== 'admin') {
      throw new HttpError(403, 'Admin access required');
    }

    const statistics = uploadProgressService.getStatistics();

    res.success(statistics, {
      message: 'Upload progress service statistics retrieved successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 清理上传任务 / Clean up upload task
 * DELETE /api/upload-progress/:uploadId
 */
router.delete('/:uploadId', requireAuth, validateUploadId, validateUploadOwnership, async (req, res, next) => {
  try {
    const { uploadId } = req.params;

    uploadProgressService.cleanupTask(uploadId);

    res.success({ uploadId }, {
      message: 'Upload task cleaned up successfully'
    });

  } catch (error) {
    next(error);
  }
});

// =============================================================================
// SSE支持 / SSE Support
// =============================================================================

/**
 * 获取实时上传进度 / Get real-time upload progress via SSE
 * GET /api/upload-progress/:uploadId/stream
 */
router.get('/:uploadId/stream', requireAuth, validateUploadId, validateUploadOwnership, (req, res, next) => {
  try {
    const { uploadId } = req.params;

    // 设置SSE头 / Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // 发送初始数据 / Send initial data
    const task = uploadProgressService.getUploadStatus(uploadId);
    if (task) {
      res.write(`data: ${JSON.stringify(task)}\n\n`);
    }

    // 监听进度更新 / Listen for progress updates
    const onProgress = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`data: ${JSON.stringify(data.progress)}\n\n`);
      }
    };

    const onComplete = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`data: ${JSON.stringify(data.task)}\n\n`);
        res.write('event: complete\n');
        res.write(`data: ${JSON.stringify({ uploadId })}\n\n`);
      }
    };

    const onError = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`data: ${JSON.stringify(data.task)}\n\n`);
        res.write('event: error\n');
        res.write(`data: ${JSON.stringify({ uploadId, error: data.error })}\n\n`);
      }
    };

    // 绑定事件监听器 / Bind event listeners
    uploadProgressService.on('upload:progress', onProgress);
    uploadProgressService.on('upload:completed', onComplete);
    uploadProgressService.on('upload:failed', onError);

    // 发送心跳包 / Send heartbeat
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);

    // 清理函数 / Cleanup function
    const cleanup = () => {
      clearInterval(heartbeat);
      uploadProgressService.removeListener('upload:progress', onProgress);
      uploadProgressService.removeListener('upload:completed', onComplete);
      uploadProgressService.removeListener('upload:failed', onError);
    };

    // 监听连接关闭 / Listen for connection close
    req.on('close', cleanup);
    req.on('end', cleanup);
    req.on('error', cleanup);

  } catch (error) {
    next(error);
  }
});

module.exports = router;
