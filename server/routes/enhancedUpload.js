/**
 * =============================================================================
 * 增强版上传API路由
 * Enhanced Upload API Routes
 * =============================================================================
 * Linus哲学：API要像系统调用一样稳定可靠
 * Good taste: APIs should be as stable and reliable as system calls
 * =============================================================================
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { enhancedUploadService } = require('../services/enhancedUploadService');
const { authenticateToken } = require('../middleware/auth');
const { HttpError, BadRequestError, NotFoundError } = require('../utils/httpError');
const logger = require('../utils/logger');

const requireAuth = authenticateToken;

// =============================================================================
// 配置和验证 / Configuration and Validation
// =============================================================================

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 10
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'text/plain'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'), false);
    }
  }
});

// 验证模式
const startProcessingSchema = z.object({
  patientId: z.string().optional(),
  options: z.object({
    enableProgressTracking: z.boolean().optional(),
    enableStageTracking: z.boolean().optional(),
    enableRetry: z.boolean().optional(),
    maxRetries: z.number().int().min(0).max(5).optional(),
    timeout: z.number().int().min(1000).max(3600000).optional() // 1秒到1小时
  }).optional()
});

const retryStageSchema = z.object({
  stage: z.enum(['upload', 'ocr', 'parsing', 'matching']),
  options: z.object({
    forceRetry: z.boolean().optional(),
    skipValidation: z.boolean().optional()
  }).optional()
});

const batchStatusSchema = z.object({
  uploadIds: z.array(z.string().min(1)).min(1).max(100) // 最多100个
});

// =============================================================================
// API路由 / API Routes
// =============================================================================

/**
 * 开始增强版文件处理
 * POST /api/enhanced-upload/start
 */
router.post('/start', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new BadRequestError('没有上传文件');
    }

    // 验证请求数据
    const validation = startProcessingSchema.safeParse({
      patientId: req.body.patientId,
      options: req.body.options ? JSON.parse(req.body.options) : undefined
    });

    if (!validation.success) {
      throw new BadRequestError('无效的请求数据', {
        details: validation.error.issues
      });
    }

    const { patientId, options } = validation.data;
    const file = req.file;

    logger.info({
      userId: req.userId,
      patientId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype
    }, 'Starting enhanced file processing');

    // 开始增强版处理
    const result = await enhancedUploadService.startEnhancedProcessing(
      file.filename, // 使用文件名作为uploadId
      file,
      patientId,
      { ...(options || {}), userId: req.userId }
    );

    res.success(result, {
      message: '增强版文件处理已启动',
      status: 201
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取增强版上传状态
 * GET /api/enhanced-upload/status/:uploadId
 */
router.get('/status/:uploadId', requireAuth, async (req, res, next) => {
  try {
    const { uploadId } = req.params;

    const status = await enhancedUploadService.getUploadStatus(uploadId);

    if (!status) {
      throw new NotFoundError('上传任务未找到');
    }

    // 检查用户权限
    if (status.userId !== req.userId) {
      throw new HttpError(403, '无权访问此上传任务');
    }

    res.success(status, {
      message: '获取上传状态成功'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取处理指标
 * GET /api/enhanced-upload/metrics/:uploadId
 */
router.get('/metrics/:uploadId', requireAuth, async (req, res, next) => {
  try {
    const { uploadId } = req.params;

    const metrics = await enhancedUploadService.getProcessingMetrics(uploadId);

    if (!metrics) {
      throw new NotFoundError('处理指标未找到');
    }

    res.success(metrics, {
      message: '获取处理指标成功'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 重试失败的阶段
 * POST /api/enhanced-upload/retry/:uploadId
 */
router.post('/retry/:uploadId', requireAuth, async (req, res, next) => {
  try {
    const { uploadId } = req.params;

    // 验证请求数据
    const validation = retryStageSchema.safeParse(req.body);
    if (!validation.success) {
      throw new BadRequestError('无效的重试数据', {
        details: validation.error.issues
      });
    }

    const { stage, options } = validation.data;

    logger.info({
      userId: req.userId,
      uploadId,
      stage
    }, 'Retrying failed stage');

    const result = await enhancedUploadService.retryFailedStage(
      uploadId,
      stage,
      options
    );

    res.success(result, {
      message: '阶段重试已启动'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 取消增强版上传
 * POST /api/enhanced-upload/cancel/:uploadId
 */
router.post('/cancel/:uploadId', requireAuth, async (req, res, next) => {
  try {
    const { uploadId } = req.params;

    logger.info({
      userId: req.userId,
      uploadId
    }, 'Cancelling enhanced upload');

    const result = await enhancedUploadService.cancelProcessing(uploadId);

    res.success(result, {
      message: '上传任务已取消'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取批量上传状态
 * POST /api/enhanced-upload/batch/status
 */
router.post('/batch/status', requireAuth, async (req, res, next) => {
  try {
    // 验证请求数据
    const validation = batchStatusSchema.safeParse(req.body);
    if (!validation.success) {
      throw new BadRequestError('无效的批量状态请求', {
        details: validation.error.issues
      });
    }

    const { uploadIds } = validation.data;

    logger.info({
      userId: req.userId,
      uploadCount: uploadIds.length
    }, 'Getting batch upload status');

    const results = await Promise.all(
      uploadIds.map(async (uploadId) => {
        try {
          const status = await enhancedUploadService.getUploadStatus(uploadId);
          return { uploadId, status, error: null };
        } catch (error) {
          return { uploadId, status: null, error: error.message };
        }
      })
    );

    res.success({ results }, {
      message: '批量状态获取成功'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取上传统计信息
 * GET /api/enhanced-upload/statistics
 */
router.get('/statistics', requireAuth, async (req, res, next) => {
  try {
    const { timeRange = 'week' } = req.query;

    const statistics = await enhancedUploadService.getUploadStatistics({
      userId: req.userId,
      timeRange
    });

    res.success(statistics, {
      message: '获取统计信息成功'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * 获取服务健康状态
 * GET /api/enhanced-upload/health
 */
router.get('/health', async (req, res, next) => {
  try {
    const healthStatus = enhancedUploadService.getHealthStatus();

    res.success(healthStatus, {
      message: '服务健康状态获取成功'
    });

  } catch (error) {
    next(error);
  }
});

// =============================================================================
// SSE支持 / SSE Support
// =============================================================================

/**
 * 增强版上传实时推送
 * GET /api/enhanced-upload/stream/:uploadId
 */
router.get('/stream/:uploadId', requireAuth, (req, res, next) => {
  try {
    const { uploadId } = req.params;

    // 验证用户权限
    const status = enhancedUploadService.getUploadStatus(uploadId);
    if (!status || status.userId !== req.userId) {
      throw new NotFoundError('上传任务未找到或无访问权限');
    }

    // 设置SSE头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });

    // 发送初始数据
    res.write(`data: ${JSON.stringify(status)}\n\n`);

    // 监听事件
    const onProgress = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`event: progress\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onStageChange = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`event: stage\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onComplete = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`event: complete\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onError = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onMetrics = (data) => {
      if (data.uploadId === uploadId) {
        res.write(`event: metrics\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    // 绑定事件监听器
    enhancedUploadService.on('progress', onProgress);
    enhancedUploadService.on('stage:change', onStageChange);
    enhancedUploadService.on('complete', onComplete);
    enhancedUploadService.on('error', onError);
    enhancedUploadService.on('metrics', onMetrics);

    // 发送心跳包
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);

    // 清理函数
    const cleanup = () => {
      clearInterval(heartbeat);
      enhancedUploadService.removeListener('progress', onProgress);
      enhancedUploadService.removeListener('stage:change', onStageChange);
      enhancedUploadService.removeListener('complete', onComplete);
      enhancedUploadService.removeListener('error', onError);
      enhancedUploadService.removeListener('metrics', onMetrics);
    };

    // 监听连接关闭
    req.on('close', cleanup);
    req.on('end', cleanup);
    req.on('error', cleanup);

  } catch (error) {
    next(error);
  }
});

// =============================================================================
// 错误处理 / Error Handling
// =============================================================================

router.use((error, req, res, next) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: '文件大小超过限制（最大50MB）'
    });
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({
      success: false,
      message: '文件数量超过限制（最多10个）'
    });
  }

  if (error.message === '不支持的文件类型') {
    return res.status(415).json({
      success: false,
      message: '不支持的文件类型。支持PDF、JPG、PNG、TIFF、TXT格式'
    });
  }

  next(error);
});

module.exports = router;
