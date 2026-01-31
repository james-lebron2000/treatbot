/**
 * =============================================================================
 * 增强版上传服务
 * Enhanced Upload Service
 * =============================================================================
 * Linus哲学：服务要像内核模块一样可插拔、可扩展
 * Good taste: Services should be pluggable and extensible like kernel modules
 * =============================================================================
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');
const { uploadProgressService } = require('./uploadProgressService');
const { defaultContainer } = require('./ServiceContainer');

// =============================================================================
// 类型定义和常量 / Type Definitions and Constants
// =============================================================================

const PROCESSING_STAGES = {
  UPLOAD: 'upload',
  OCR: 'ocr',
  PARSING: 'parsing',
  MATCHING: 'matching',
  COMPLETE: 'complete'
};

const STAGE_WEIGHTS = {
  [PROCESSING_STAGES.UPLOAD]: 0.1,     // 上传占10%
  [PROCESSING_STAGES.OCR]: 0.3,        // OCR占30%
  [PROCESSING_STAGES.PARSING]: 0.4,    // 解析占40%
  [PROCESSING_STAGES.MATCHING]: 0.2    // 匹配占20%
};

const DEFAULT_CONFIG = {
  enableProgressTracking: true,
  enableStageTracking: true,
  enableTimeEstimation: true,
  enableCaching: true,
  enableRetry: true,
  maxRetries: 3,
  retryDelay: 1000,
  stageTimeout: 300000, // 5分钟
  totalTimeout: 1800000 // 30分钟
};

// =============================================================================
// 增强版上传服务类 / Enhanced Upload Service Class
// =============================================================================

class EnhancedUploadService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeProcesses = new Map();
    this.processingQueues = new Map();
    this.performanceMetrics = new Map();
    this.startTime = Date.now();
  }

  // =============================================================================
  // 核心API / Core API
  // =============================================================================

  /**
   * 开始增强版文件处理流程
   * Start enhanced file processing workflow
   */
  async startEnhancedProcessing(uploadId, file, patientId, options = {}) {
    const processId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info({ uploadId, processId, patientId }, 'Starting enhanced file processing');

      // 创建处理上下文
      const context = {
        uploadId,
        processId,
        patientId,
        file,
        startTime: Date.now(),
        stageStartTimes: new Map(),
        retryCount: 0,
        errors: [],
        results: {},
        ...options
      };

      this.activeProcesses.set(processId, context);
      this.processingQueues.set(processId, new Map());

      // 初始化上传进度
      await this.initializeProgress(context);

      // 开始处理流程
      const result = await this.executeProcessingWorkflow(context);

      logger.info({ uploadId, processId, processingTime: Date.now() - context.startTime },
                  'Enhanced file processing completed');

      return result;

    } catch (error) {
      logger.error({ uploadId, processId, error }, 'Enhanced file processing failed');

      // 失败处理
      await this.handleProcessingFailure(uploadId, error);

      throw error;
    } finally {
      // 清理资源
      this.cleanupProcess(processId);
    }
  }

  /**
   * 执行处理工作流
   * Execute processing workflow
   */
  async executeProcessingWorkflow(context) {
    const stages = [
      { name: PROCESSING_STAGES.UPLOAD, handler: this.handleUploadStage.bind(this) },
      { name: PROCESSING_STAGES.OCR, handler: this.handleOCRStage.bind(this) },
      { name: PROCESSING_STAGES.PARSING, handler: this.handleParsingStage.bind(this) },
      { name: PROCESSING_STAGES.MATCHING, handler: this.handleMatchingStage.bind(this) }
    ];

    let overallResult = {};

    for (const stage of stages) {
      try {
        // 开始阶段
        await this.startStage(context, stage.name);

        // 执行阶段处理
        const stageResult = await this.executeStageWithTimeout(
          context,
          stage.name,
          stage.handler
        );

        // 保存阶段结果
        overallResult[stage.name] = stageResult;
        context.results[stage.name] = stageResult;

        // 更新进度
        await this.completeStage(context, stage.name);

      } catch (error) {
        logger.error({
          uploadId: context.uploadId,
          stage: stage.name,
          error
        }, 'Stage processing failed');

        // 阶段重试逻辑
        const retryResult = await this.handleStageRetry(context, stage.name, error);

        if (!retryResult.success) {
          throw new Error(`Stage ${stage.name} failed after retries: ${retryResult.error}`);
        }

        overallResult[stage.name] = retryResult.result;
        context.results[stage.name] = retryResult.result;
      }
    }

    // 完成整个流程
    await this.completeProcessing(context, overallResult);

    return overallResult;
  }

  /**
   * 初始化进度跟踪
   * Initialize progress tracking
   */
  async initializeProgress(context) {
    if (!this.config.enableProgressTracking) return;

    try {
      // 创建上传进度任务
      await uploadProgressService.createUploadTask(
        context.uploadId,
        {
          originalName: context.file.name,
          size: context.file.size
        },
        context.userId
      );

      // 记录性能指标
      this.recordPerformanceMetric('process_start', context.processId, {
        uploadId: context.uploadId,
        fileSize: context.file.size,
        patientId: context.patientId
      });

    } catch (error) {
      logger.warn({ uploadId: context.uploadId, error }, 'Failed to initialize progress tracking');
    }
  }

  /**
   * 开始处理阶段
   * Start processing stage
   */
  async startStage(context, stageName) {
    if (!this.config.enableStageTracking) return;

    context.stageStartTimes.set(stageName, Date.now());

    try {
      await uploadProgressService.startStage(
        context.uploadId,
        stageName,
        this.getStageMessage(stageName, 'start')
      );

      this.emit('stage:start', {
        uploadId: context.uploadId,
        stage: stageName,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.warn({ uploadId: context.uploadId, stage: stageName, error },
                  'Failed to start stage tracking');
    }
  }

  /**
   * 执行阶段处理（带超时）
   * Execute stage processing with timeout
   */
  async executeStageWithTimeout(context, stageName, handler) {
    const timeout = this.config.stageTimeout;

    return Promise.race([
      handler(context),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Stage ${stageName} timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * 完成处理阶段
   * Complete processing stage
   */
  async completeStage(context, stageName) {
    if (!this.config.enableStageTracking) return;

    const stageStartTime = context.stageStartTimes.get(stageName);
    const stageDuration = stageStartTime ? Date.now() - stageStartTime : 0;

    try {
      // 更新阶段进度到100%
      await uploadProgressService.updateStageProgress(
        context.uploadId,
        100,
        this.getStageMessage(stageName, 'complete')
      );

      // 记录性能指标
      this.recordPerformanceMetric('stage_complete', `${context.processId}_${stageName}`, {
        stage: stageName,
        duration: stageDuration,
        uploadId: context.uploadId
      });

      this.emit('stage:complete', {
        uploadId: context.uploadId,
        stage: stageName,
        duration: stageDuration
      });

    } catch (error) {
      logger.warn({ uploadId: context.uploadId, stage: stageName, error },
                  'Failed to complete stage tracking');
    }
  }

  /**
   * 处理上传阶段
   * Handle upload stage
   */
  async handleUploadStage(context) {
    const ocrService = defaultContainer.deps.ocrService;

    // 模拟文件上传进度
    await this.simulateStageProgress(context.uploadId, PROCESSING_STAGES.UPLOAD, 2000);

    // 执行OCR处理
    const ocrResult = await ocrService.recognizeFile(context.file.path, context.file.mimetype);

    if (!ocrResult.success) {
      throw new Error(`OCR processing failed: ${ocrResult.error}`);
    }

    return {
      extractedText: ocrResult.extractedText,
      metadata: ocrResult.metadata,
      success: true
    };
  }

  /**
   * 处理OCR阶段
   * Handle OCR stage
   */
  async handleOCRStage(context) {
    const uploadResult = context.results[PROCESSING_STAGES.UPLOAD];

    if (!uploadResult || !uploadResult.extractedText) {
      throw new Error('No extracted text available for parsing');
    }

    // 模拟OCR处理进度
    await this.simulateStageProgress(context.uploadId, PROCESSING_STAGES.OCR, 3000);

    return {
      text: uploadResult.extractedText,
      confidence: uploadResult.metadata?.confidence || 0,
      processingTime: uploadResult.metadata?.processingTime || 0,
      success: true
    };
  }

  /**
   * 处理解析阶段
   * Handle parsing stage
   */
  async handleParsingStage(context) {
    const ocrResult = context.results[PROCESSING_STAGES.OCR];

    if (!ocrResult || !ocrResult.text) {
      throw new Error('No text available for parsing');
    }

    const stepwiseLLMService = defaultContainer.deps.stepwiseLLMService;

    // 开始分步提取
    const extractionResult = await stepwiseLLMService.startStepwiseExtraction(
      ocrResult.text,
      context.patientId,
      {
        userId: context.userId,
        recordId: context.recordId
      }
    );

    // 模拟解析进度
    await this.simulateStageProgress(context.uploadId, PROCESSING_STAGES.PARSING, 4000);

    return {
      jobId: extractionResult.jobId,
      structuredData: extractionResult.structuredData,
      success: true
    };
  }

  /**
   * 处理匹配阶段
   * Handle matching stage
   */
  async handleMatchingStage(context) {
    const parsingResult = context.results[PROCESSING_STAGES.PARSING];

    if (!parsingResult || !parsingResult.structuredData) {
      throw new Error('No structured data available for matching');
    }

    const hybridMatchingService = defaultContainer.deps.hybridMatchingService;

    // 执行混合匹配
    const matchResult = await hybridMatchingService.match({
      patientData: parsingResult.structuredData,
      options: {
        llmReview: { enabled: true }
      }
    });

    // 模拟匹配进度
    await this.simulateStageProgress(context.uploadId, PROCESSING_STAGES.MATCHING, 2000);

    return {
      matches: matchResult.matches,
      metadata: matchResult.metadata,
      success: true
    };
  }

  /**
   * 模拟阶段进度
   * Simulate stage progress
   */
  async simulateStageProgress(uploadId, stageName, totalDuration) {
    if (!this.config.enableProgressTracking) return;

    const steps = 20;
    const stepDuration = totalDuration / steps;

    for (let i = 0; i <= steps; i++) {
      const progress = Math.round((i / steps) * 100);

      try {
        await uploadProgressService.updateStageProgress(
          uploadId,
          progress,
          this.getStageMessage(stageName, 'progress', progress)
        );
      } catch (error) {
        logger.warn({ uploadId, stage: stageName, progress, error },
                    'Failed to update stage progress');
      }

      if (i < steps) {
        await new Promise(resolve => setTimeout(resolve, stepDuration));
      }
    }
  }

  /**
   * 完成整个处理流程
   * Complete entire processing workflow
   */
  async completeProcessing(context, finalResult) {
    if (!this.config.enableProgressTracking) return;

    try {
      // 完成上传进度
      await uploadProgressService.completeUpload(context.uploadId, finalResult);

      // 记录性能指标
      const totalDuration = Date.now() - context.startTime;
      this.recordPerformanceMetric('process_complete', context.processId, {
        uploadId: context.uploadId,
        totalDuration,
        results: finalResult
      });

      this.emit('process:complete', {
        uploadId: context.uploadId,
        processId: context.processId,
        duration: totalDuration,
        results: finalResult
      });

    } catch (error) {
      logger.warn({ uploadId: context.uploadId, error },
                  'Failed to complete processing tracking');
    }
  }

  /**
   * 处理阶段重试
   * Handle stage retry
   */
  async handleStageRetry(context, stageName, originalError) {
    if (!this.config.enableRetry || context.retryCount >= this.config.maxRetryCount) {
      return {
        success: false,
        error: originalError.message || 'Stage failed and no retries remaining'
      };
    }

    context.retryCount++;
    context.errors.push({
      stage: stageName,
      error: originalError.message,
      retryCount: context.retryCount,
      timestamp: Date.now()
    });

    logger.info({
      uploadId: context.uploadId,
      stage: stageName,
      retryCount: context.retryCount
    }, 'Retrying failed stage');

    try {
      // 等待重试延迟
      await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * context.retryCount));

      // 重置阶段进度
      await uploadProgressService.updateProgress(context.uploadId, {
        message: `重试阶段: ${stageName} (尝试 ${context.retryCount}/${this.config.maxRetryCount})`,
        retryCount: context.retryCount
      });

      // 重新执行阶段
      const stageHandlers = {
        [PROCESSING_STAGES.UPLOAD]: this.handleUploadStage.bind(this),
        [PROCESSING_STAGES.OCR]: this.handleOCRStage.bind(this),
        [PROCESSING_STAGES.PARSING]: this.handleParsingStage.bind(this),
        [PROCESSING_STAGES.MATCHING]: this.handleMatchingStage.bind(this)
      };

      const handler = stageHandlers[stageName];
      if (!handler) {
        throw new Error(`No handler found for stage: ${stageName}`);
      }

      const result = await this.executeStageWithTimeout(context, stageName, handler);

      return {
        success: true,
        result
      };

    } catch (retryError) {
      logger.error({
        uploadId: context.uploadId,
        stage: stageName,
        retryCount: context.retryCount,
        error: retryError
      }, 'Stage retry failed');

      return {
        success: false,
        error: retryError.message || 'Stage retry failed'
      };
    }
  }

  /**
   * 处理处理失败
   * Handle processing failure
   */
  async handleProcessingFailure(uploadId, error) {
    try {
      await uploadProgressService.failUpload(uploadId, error.message || 'Processing failed');
    } catch (progressError) {
      logger.error({ uploadId, error: progressError }, 'Failed to update progress on failure');
    }
  }

  /**
   * 清理处理过程
   * Clean up processing
   */
  cleanupProcess(processId) {
    this.activeProcesses.delete(processId);
    this.processingQueues.delete(processId);
    this.performanceMetrics.delete(processId);
  }

  // =============================================================================
  // 性能指标 / Performance Metrics
  // =============================================================================

  /**
   * 记录性能指标
   * Record performance metric
   */
  recordPerformanceMetric(type, key, data) {
    if (!this.performanceMetrics.has(key)) {
      this.performanceMetrics.set(key, []);
    }

    const metrics = this.performanceMetrics.get(key);
    metrics.push({
      type,
      timestamp: Date.now(),
      data
    });

    // 限制指标数量
    if (metrics.length > 100) {
      metrics.shift();
    }
  }

  /**
   * 获取性能统计
   * Get performance statistics
   */
  getPerformanceStats() {
    const stats = {
      totalProcesses: this.performanceMetrics.size,
      averageProcessingTime: 0,
      successRate: 0,
      stageStats: {},
      timestamp: new Date().toISOString()
    };

    let totalDuration = 0;
    let completedCount = 0;
    let successCount = 0;

    for (const [key, metrics] of this.performanceMetrics) {
      for (const metric of metrics) {
        if (metric.type === 'process_complete') {
          completedCount++;
          totalDuration += metric.data.totalDuration;

          if (metric.data.results) {
            successCount++;
          }
        }
      }
    }

    if (completedCount > 0) {
      stats.averageProcessingTime = Math.round(totalDuration / completedCount);
      stats.successRate = Math.round((successCount / completedCount) * 100);
    }

    return stats;
  }

  // =============================================================================
  // 工具方法 / Utility Methods
  // =============================================================================

  /**
   * 获取阶段消息
   * Get stage message
   */
  getStageMessage(stage, type = 'start', progress = 0) {
    const messages = {
      [PROCESSING_STAGES.UPLOAD]: {
        start: '开始上传文件...',
        progress: `上传进度: ${progress}%`,
        complete: '文件上传完成'
      },
      [PROCESSING_STAGES.OCR]: {
        start: '开始OCR文字识别...',
        progress: `OCR识别进度: ${progress}%`,
        complete: '文字识别完成'
      },
      [PROCESSING_STAGES.PARSING]: {
        start: '开始解析医疗文本...',
        progress: `解析进度: ${progress}%`,
        complete: '医疗文本解析完成'
      },
      [PROCESSING_STAGES.MATCHING]: {
        start: '开始匹配临床试验...',
        progress: `匹配进度: ${progress}%`,
        complete: '临床试验匹配完成'
      }
    };

    const stageMessages = messages[stage] || messages[PROCESSING_STAGES.OCR];
    return stageMessages[type] || stageMessages.start;
  }

  /**
   * 健康检查
   * Health check
   */
  getHealthStatus() {
    const activeCount = this.activeProcesses.size;
    const uptime = Date.now() - this.startTime;

    return {
      status: 'healthy',
      activeProcesses: activeCount,
      uptime: Math.round(uptime / 1000),
      memoryUsage: process.memoryUsage(),
      performanceStats: this.getPerformanceStats(),
      timestamp: new Date().toISOString()
    };
  }
}

// =============================================================================
// 创建单例实例 / Create singleton instance
// =============================================================================

const enhancedUploadService = new EnhancedUploadService();

// =============================================================================
// 事件监听 / Event Listeners
// =============================================================================

enhancedUploadService.on('stage:start', ({ uploadId, stage }) => {
  logger.debug({ uploadId, stage }, 'Processing stage started');
});

enhancedUploadService.on('stage:complete', ({ uploadId, stage, duration }) => {
  logger.info({ uploadId, stage, duration }, 'Processing stage completed');
});

enhancedUploadService.on('process:complete', ({ uploadId, duration }) => {
  logger.info({ uploadId, duration }, 'Enhanced processing completed');
});

// =============================================================================
// 导出 / Exports
// =============================================================================

module.exports = {
  enhancedUploadService,
  EnhancedUploadService,
  PROCESSING_STAGES,
  STAGE_WEIGHTS,
  DEFAULT_CONFIG
};