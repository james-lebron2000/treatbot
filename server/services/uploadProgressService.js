/**
 * =============================================================================
 * 上传进度服务
 * Upload Progress Service
 * =============================================================================
 * Linus哲学：用最简单的机制实现最可靠的状态跟踪
 * Good taste: Simplest mechanism for most reliable state tracking
 * =============================================================================
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');
const cacheService = require('./cache');

// =============================================================================
// 类型定义和常量 / Type Definitions and Constants
// =============================================================================

const UPLOAD_STATUS = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

const PROCESSING_STAGE = {
  OCR: 'ocr',
  PARSING: 'parsing',
  MATCHING: 'matching',
  COMPLETE: 'complete'
};

const DEFAULT_TTL = 3600; // 1小时 / 1 hour
const PROGRESS_CACHE_PREFIX = 'upload:progress:';
const STAGE_WEIGHTS = {
  [PROCESSING_STAGE.OCR]: 0.3,      // OCR占30% / OCR takes 30%
  [PROCESSING_STAGE.PARSING]: 0.4,   // 解析占40% / Parsing takes 40%
  [PROCESSING_STAGE.MATCHING]: 0.3   // 匹配占30% / Matching takes 30%
};

// =============================================================================
// 上传进度服务类 / Upload Progress Service Class
// =============================================================================

class UploadProgressService extends EventEmitter {
  constructor() {
    super();
    this.activeUploads = new Map();
    this.processingStages = new Map();
    this.startTime = Date.now();
  }

  // =============================================================================
  // 核心API / Core API
  // =============================================================================

  /**
   * 创建上传任务 / Create upload task
   */
  createUploadTask(uploadId, fileInfo = {}, userId = null) {
    const task = {
      id: uploadId,
      userId,
      status: UPLOAD_STATUS.IDLE,
      progress: 0,
      stage: null,
      stageProgress: 0,
      message: '准备上传...',
      fileName: fileInfo.originalName || 'unknown',
      fileSize: fileInfo.size || 0,
      error: null,
      retryCount: 0,
      startTime: Date.now(),
      processingTime: 0,
      estimatedTime: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.activeUploads.set(uploadId, task);
    this.processingStages.set(uploadId, {
      currentStage: null,
      stageStartTime: null,
      stageProgress: 0
    });

    // 缓存任务信息 / Cache task information
    this.cacheTask(uploadId, task);

    this.emit('upload:created', { uploadId, task });
    logger.info({ uploadId, userId }, 'Upload task created');

    return task;
  }

  /**
   * 更新上传进度 / Update upload progress
   */
  updateProgress(uploadId, updates) {
    const task = this.activeUploads.get(uploadId);
    if (!task) {
      logger.warn({ uploadId }, 'Upload task not found for progress update');
      return null;
    }

    const now = Date.now();
    const processingTime = Math.round((now - task.startTime) / 1000);

    // 计算预估时间 / Calculate estimated time
    let estimatedTime = updates.estimatedTime || null;
    if (updates.progress > task.progress && updates.progress < 100) {
      const rate = updates.progress / processingTime;
      estimatedTime = Math.round((100 - updates.progress) / rate);
    }

    // 更新任务状态 / Update task status
    const updatedTask = {
      ...task,
      ...updates,
      processingTime,
      estimatedTime,
      updatedAt: new Date()
    };

    this.activeUploads.set(uploadId, updatedTask);
    this.cacheTask(uploadId, updatedTask);

    this.emit('upload:progress', { uploadId, progress: updatedTask });

    return updatedTask;
  }

  /**
   * 开始处理阶段 / Start processing stage
   */
  startStage(uploadId, stage, message = null) {
    const task = this.activeUploads.get(uploadId);
    if (!task) return null;

    const stageInfo = {
      currentStage: stage,
      stageStartTime: Date.now(),
      stageProgress: 0
    };

    this.processingStages.set(uploadId, stageInfo);

    // 计算阶段基准进度 / Calculate stage base progress
    let baseProgress = 0;
    switch (stage) {
      case PROCESSING_STAGE.PARSING:
        baseProgress = STAGE_WEIGHTS[PROCESSING_STAGE.OCR] * 100;
        break;
      case PROCESSING_STAGE.MATCHING:
        baseProgress = (STAGE_WEIGHTS[PROCESSING_STAGE.OCR] + STAGE_WEIGHTS[PROCESSING_STAGE.PARSING]) * 100;
        break;
      case PROCESSING_STAGE.COMPLETE:
        baseProgress = 100;
        break;
    }

    const stageMessage = message || this.getStageMessage(stage);

    return this.updateProgress(uploadId, {
      status: UPLOAD_STATUS.PROCESSING,
      stage,
      stageProgress: 0,
      message: stageMessage,
      progress: baseProgress
    });
  }

  /**
   * 更新阶段进度 / Update stage progress
   */
  updateStageProgress(uploadId, stageProgress, message = null) {
    const task = this.activeUploads.get(uploadId);
    const stageInfo = this.processingStages.get(uploadId);

    if (!task || !stageInfo || !stageInfo.currentStage) return null;

    // 更新阶段信息 / Update stage information
    stageInfo.stageProgress = stageProgress;

    // 计算总体进度 / Calculate overall progress
    let baseProgress = 0;
    switch (stageInfo.currentStage) {
      case PROCESSING_STAGE.OCR:
        baseProgress = 0;
        break;
      case PROCESSING_STAGE.PARSING:
        baseProgress = STAGE_WEIGHTS[PROCESSING_STAGE.OCR] * 100;
        break;
      case PROCESSING_STAGE.MATCHING:
        baseProgress = (STAGE_WEIGHTS[PROCESSING_STAGE.OCR] + STAGE_WEIGHTS[PROCESSING_STAGE.PARSING]) * 100;
        break;
    }

    const stageWeight = STAGE_WEIGHTS[stageInfo.currentStage] || 0;
    const overallProgress = Math.round(
      baseProgress + (stageProgress * stageWeight)
    );

    const updates = {
      stageProgress,
      progress: Math.min(overallProgress, 99), // 完成前不超过99% / Don't exceed 99% before completion
      updatedAt: new Date()
    };

    if (message) {
      updates.message = message;
    }

    return this.updateProgress(uploadId, updates);
  }

  /**
   * 完成上传任务 / Complete upload task
   */
  completeUpload(uploadId, result = null) {
    const task = this.activeUploads.get(uploadId);
    if (!task) return null;

    const completedTask = this.updateProgress(uploadId, {
      status: UPLOAD_STATUS.COMPLETED,
      progress: 100,
      stage: PROCESSING_STAGE.COMPLETE,
      stageProgress: 100,
      message: '处理完成',
      estimatedTime: 0,
      processingTime: Math.round((Date.now() - task.startTime) / 1000)
    });

    // 清理资源 / Clean up resources
    setTimeout(() => {
      this.cleanupTask(uploadId);
    }, 60000); // 1分钟后清理 / Clean up after 1 minute

    this.emit('upload:completed', { uploadId, result, task: completedTask });
    logger.info({ uploadId, processingTime: completedTask.processingTime }, 'Upload task completed');

    return completedTask;
  }

  /**
   * 标记上传失败 / Mark upload as failed
   */
  failUpload(uploadId, error, retryable = true) {
    const task = this.activeUploads.get(uploadId);
    if (!task) return null;

    const failedTask = this.updateProgress(uploadId, {
      status: UPLOAD_STATUS.ERROR,
      message: '处理失败',
      error: error.message || error,
      estimatedTime: 0
    });

    this.emit('upload:failed', { uploadId, error, task: failedTask, retryable });
    logger.error({ uploadId, error }, 'Upload task failed');

    return failedTask;
  }

  /**
   * 取消上传任务 / Cancel upload task
   */
  cancelUpload(uploadId) {
    const task = this.activeUploads.get(uploadId);
    if (!task) return null;

    const cancelledTask = this.updateProgress(uploadId, {
      status: UPLOAD_STATUS.CANCELLED,
      message: '已取消',
      estimatedTime: 0
    });

    this.cleanupTask(uploadId);
    this.emit('upload:cancelled', { uploadId, task: cancelledTask });
    logger.info({ uploadId }, 'Upload task cancelled');

    return cancelledTask;
  }

  /**
   * 获取上传任务状态 / Get upload task status
   */
  getUploadStatus(uploadId) {
    return this.activeUploads.get(uploadId) || null;
  }

  /**
   * 获取用户的所有活跃上传 / Get all active uploads for user
   */
  getUserUploads(userId) {
    const userUploads = [];
    for (const [id, task] of this.activeUploads) {
      if (task.userId === userId) {
        userUploads.push(task);
      }
    }
    return userUploads;
  }

  /**
   * 获取所有活跃上传 / Get all active uploads
   */
  getAllUploads() {
    return Array.from(this.activeUploads.values());
  }

  /**
   * 清理上传任务 / Clean up upload task
   */
  cleanupTask(uploadId) {
    this.activeUploads.delete(uploadId);
    this.processingStages.delete(uploadId);
    this.clearCachedTask(uploadId);
    this.emit('upload:cleanup', { uploadId });
  }

  // =============================================================================
  // 缓存管理 / Cache Management
  // =============================================================================

  /**
   * 缓存任务 / Cache task
   */
  async cacheTask(uploadId, task) {
    try {
      const cacheKey = `${PROGRESS_CACHE_PREFIX}${uploadId}`;
      await cacheService.set(cacheKey, task, DEFAULT_TTL);
    } catch (error) {
      logger.error({ uploadId, error }, 'Failed to cache upload task');
    }
  }

  /**
   * 从缓存获取任务 / Get task from cache
   */
  async getCachedTask(uploadId) {
    try {
      const cacheKey = `${PROGRESS_CACHE_PREFIX}${uploadId}`;
      return await cacheService.get(cacheKey);
    } catch (error) {
      logger.error({ uploadId, error }, 'Failed to get cached upload task');
      return null;
    }
  }

  /**
   * 清除缓存任务 / Clear cached task
   */
  async clearCachedTask(uploadId) {
    try {
      const cacheKey = `${PROGRESS_CACHE_PREFIX}${uploadId}`;
      await cacheService.del(cacheKey);
    } catch (error) {
      logger.error({ uploadId, error }, 'Failed to clear cached upload task');
    }
  }

  // =============================================================================
  // 工具方法 / Utility Methods
  // =============================================================================

  /**
   * 获取阶段描述消息 / Get stage description message
   */
  getStageMessage(stage) {
    const messages = {
      [PROCESSING_STAGE.OCR]: [
        '正在识别文档中的文字...',
        'OCR识别进行中，请稍候...',
        '文字识别即将完成...'
      ],
      [PROCESSING_STAGE.PARSING]: [
        '正在解析医疗文本内容...',
        '医疗数据提取中...',
        '结构化处理即将完成...'
      ],
      [PROCESSING_STAGE.MATCHING]: [
        '正在匹配临床试验...',
        '试验匹配进行中...',
        '匹配结果整理中...'
      ],
      [PROCESSING_STAGE.COMPLETE]: [
        '处理完成！',
        '所有步骤已完成',
        '准备就绪'
      ]
    };

    const stageMessages = messages[stage] || messages[PROCESSING_STAGE.OCR];
    const randomIndex = Math.floor(Math.random() * stageMessages.length);
    return stageMessages[randomIndex];
  }

  /**
   * 计算预估时间 / Calculate estimated time
   */
  calculateEstimatedTime(progress, startTime, currentTime = Date.now()) {
    if (progress <= 0 || progress >= 100) return 0;

    const elapsed = (currentTime - startTime) / 1000; // 秒
    const rate = progress / elapsed; // 进度/秒

    return Math.round((100 - progress) / rate); // 剩余秒数
  }

  /**
   * 健康检查 / Health check
   */
  getHealthStatus() {
    const activeCount = this.activeUploads.size;
    const uptime = Date.now() - this.startTime;

    return {
      status: 'healthy',
      activeUploads: activeCount,
      uptime: Math.round(uptime / 1000), // 秒
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 获取服务统计 / Get service statistics
   */
  getStatistics() {
    const stats = {
      totalActive: this.activeUploads.size,
      byStatus: {},
      byStage: {},
      averageProcessingTime: 0,
      timestamp: new Date().toISOString()
    };

    // 按状态统计 / Statistics by status
    for (const [status, label] of Object.entries(UPLOAD_STATUS)) {
      stats.byStatus[label] = 0;
    }

    // 按阶段统计 / Statistics by stage
    for (const [stage, label] of Object.entries(PROCESSING_STAGE)) {
      stats.byStage[label] = 0;
    }

    let totalProcessingTime = 0;
    let completedCount = 0;

    for (const task of this.activeUploads.values()) {
      stats.byStatus[task.status]++;
      if (task.stage) {
        stats.byStage[task.stage]++;
      }

      if (task.processingTime > 0) {
        totalProcessingTime += task.processingTime;
        completedCount++;
      }
    }

    if (completedCount > 0) {
      stats.averageProcessingTime = Math.round(totalProcessingTime / completedCount);
    }

    return stats;
  }

  /**
   * 清理过期任务 / Clean up expired tasks
   */
  cleanupExpiredTasks(maxAge = 86400000) { // 默认24小时 / Default 24 hours
    const now = Date.now();
    let cleanedCount = 0;

    for (const [uploadId, task] of this.activeUploads) {
      if (now - task.updatedAt.getTime() > maxAge) {
        this.cleanupTask(uploadId);
        cleanedCount++;
      }
    }

    logger.info({ cleanedCount }, 'Cleaned up expired upload tasks');
    return cleanedCount;
  }
}

// =============================================================================
// 创建单例实例 / Create singleton instance
// =============================================================================

const uploadProgressService = new UploadProgressService();

// =============================================================================
// 事件监听 / Event Listeners
// =============================================================================

uploadProgressService.on('upload:created', ({ uploadId, task }) => {
  logger.debug({ uploadId, userId: task.userId }, 'Upload created event');
});

uploadProgressService.on('upload:completed', ({ uploadId, result, task }) => {
  logger.info({ uploadId, processingTime: task.processingTime }, 'Upload completed event');
});

uploadProgressService.on('upload:failed', ({ uploadId, error, task }) => {
  logger.error({ uploadId, error }, 'Upload failed event');
});

// =============================================================================
// 定时清理任务 / Scheduled cleanup tasks
// =============================================================================

// 每小时清理过期任务 / Clean up expired tasks every hour
setInterval(() => {
  uploadProgressService.cleanupExpiredTasks();
}, 3600000);

// =============================================================================
// 导出 / Exports
// =============================================================================

module.exports = {
  uploadProgressService,
  UploadProgressService,
  UPLOAD_STATUS,
  PROCESSING_STAGE,
  STAGE_WEIGHTS,
  DEFAULT_TTL,
  PROGRESS_CACHE_PREFIX
};