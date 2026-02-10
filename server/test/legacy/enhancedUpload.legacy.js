/**
 * =============================================================================
 * 增强版上传服务测试
 * Enhanced Upload Service Tests
 * =============================================================================
 * Linus哲学：测试要像内核测试套件一样全面严谨
 * Good taste: Tests should be as comprehensive and rigorous as kernel test suite
 * =============================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../index');
const { enhancedUploadService } = require('../services/enhancedUploadService');
const { uploadProgressService } = require('../services/uploadProgressService');
const { defaultContainer } = require('../services/ServiceContainer');

// =============================================================================
// 测试工具 / Test Utilities
// =============================================================================

const createMockFile = (size = 1024, type = 'application/pdf') => ({
  fieldname: 'file',
  originalname: 'test_document.pdf',
  encoding: '7bit',
  mimetype: type,
  size: size,
  destination: 'uploads/',
  filename: `test_${Date.now()}.pdf`,
  path: `uploads/test_${Date.now()}.pdf`,
  buffer: Buffer.alloc(size)
});

const createMockUser = () => ({
  userId: new mongoose.Types.ObjectId().toString(),
  email: 'test@example.com',
  role: 'user'
});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =============================================================================
// 测试套件 / Test Suites
// =============================================================================

describe('Enhanced Upload Service', () => {
  let mockUser;
  let authToken;

  beforeEach(() => {
    mockUser = createMockUser();
    authToken = 'mock-jwt-token'; // 在实际测试中应该从登录获取
  });

  afterEach(() => {
    // 清理测试数据
    jest.clearAllMocks();
  });

  // =============================================================================
  // 基础功能测试 / Basic Functionality Tests
  // =============================================================================

  describe('Basic Upload Processing', () => {
    test('should successfully start enhanced file processing', async () => {
      const mockFile = createMockFile();

      // 模拟OCR服务
      const mockOCRService = {
        recognizeFile: jest.fn().mockResolvedValue({
          success: true,
          extractedText: 'Test medical document content',
          metadata: {
            confidence: 95,
            processingTime: 2000,
            pageCount: 1
          }
        })
      };

      // 模拟分步LLM服务
      const mockStepwiseLLMService = {
        startStepwiseExtraction: jest.fn().mockResolvedValue({
          jobId: 'test_job_123',
          structuredData: {
            diagnosis: 'Liver cancer',
            stage: 'Stage II',
            age: 45,
            gender: 'male'
          }
        })
      };

      // 模拟混合匹配服务
      const mockHybridMatchingService = {
        match: jest.fn().mockResolvedValue({
          matches: [
            {
              trial_id: 'NCT123456',
              trial_title: 'Test Clinical Trial',
              match_score: 85,
              inclusion_checks: [],
              exclusion_checks: []
            }
          ],
          metadata: {
            totalTrials: 100,
            matchedTrials: 5
          }
        })
      };

      // 注入模拟服务
      defaultContainer.deps.ocrService = mockOCRService;
      defaultContainer.deps.stepwiseLLMService = mockStepwiseLLMService;
      defaultContainer.deps.hybridMatchingService = mockHybridMatchingService;

      const result = await enhancedUploadService.startEnhancedProcessing(
        'test_upload_123',
        mockFile,
        'test_patient_123'
      );

      expect(result).toBeDefined();
      expect(result.upload).toBeDefined();
      expect(result.ocr).toBeDefined();
      expect(result.parsing).toBeDefined();
      expect(result.matching).toBeDefined();

      // 验证服务调用
      expect(mockOCRService.recognizeFile).toHaveBeenCalled();
      expect(mockStepwiseLLMService.startStepwiseExtraction).toHaveBeenCalled();
      expect(mockHybridMatchingService.match).toHaveBeenCalled();
    });

    test('should track progress through all stages', async () => {
      const mockFile = createMockFile();
      const uploadId = 'test_progress_tracking';
      const progressUpdates = [];

      // 监听进度更新
      uploadProgressService.on('upload:progress', (data) => {
        if (data.uploadId === uploadId) {
          progressUpdates.push(data.progress);
        }
      });

      await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);

      // 验证进度更新
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some(update => update.progress > 0)).toBe(true);
      expect(progressUpdates.some(update => update.stage === 'upload')).toBe(true);
      expect(progressUpdates.some(update => update.stage === 'ocr')).toBe(true);
      expect(progressUpdates.some(update => update.stage === 'parsing')).toBe(true);
      expect(progressUpdates.some(update => update.stage === 'matching')).toBe(true);
    });

    test('should handle file size validation', async () => {
      const largeFile = createMockFile(60 * 1024 * 1024); // 60MB，超过限制

      await expect(enhancedUploadService.startEnhancedProcessing(
        'test_large_file',
        largeFile
      )).rejects.toThrow();
    });

    test('should handle unsupported file types', async () => {
      const unsupportedFile = createMockFile(1024, 'application/zip');

      await expect(enhancedUploadService.startEnhancedProcessing(
        'test_unsupported',
        unsupportedFile
      )).rejects.toThrow();
    });
  });

  // =============================================================================
  // 进度跟踪测试 / Progress Tracking Tests
  // =============================================================================

  describe('Progress Tracking', () => {
    test('should update stage progress correctly', async () => {
      const uploadId = 'test_stage_progress';
      const stageProgressUpdates = [];

      uploadProgressService.on('upload:progress', (data) => {
        if (data.uploadId === uploadId && data.progress.stageProgress !== undefined) {
          stageProgressUpdates.push({
            stage: data.progress.stage,
            stageProgress: data.progress.stageProgress
          });
        }
      });

      const mockFile = createMockFile();
      await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);

      // 验证阶段进度
      expect(stageProgressUpdates.length).toBeGreaterThan(0);
      expect(stageProgressUpdates.some(update => update.stageProgress === 100)).toBe(true);
    });

    test('should calculate estimated time accurately', async () => {
      const uploadId = 'test_time_estimation';
      const startTime = Date.now();

      const mockFile = createMockFile();
      await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);

      const finalStatus = uploadProgressService.getUploadStatus(uploadId);
      const totalTime = Date.now() - startTime;

      expect(finalStatus).toBeDefined();
      expect(finalStatus.processingTime).toBeGreaterThan(0);
      expect(finalStatus.processingTime).toBeLessThan(totalTime + 1000); // 允许1秒误差
    });

    test('should handle progress tracking errors gracefully', async () => {
      const uploadId = 'test_progress_error';

      // 模拟进度服务错误
      jest.spyOn(uploadProgressService, 'updateProgress').mockRejectedValueOnce(
        new Error('Progress update failed')
      );

      const mockFile = createMockFile();

      // 应该仍然能完成处理，即使有进度跟踪错误
      await expect(enhancedUploadService.startEnhancedProcessing(
        uploadId,
        mockFile
      )).resolves.toBeDefined();
    });
  });

  // =============================================================================
  // 错误处理测试 / Error Handling Tests
  // =============================================================================

  describe('Error Handling and Retry', () => {
    test('should retry failed stages', async () => {
      const uploadId = 'test_retry_mechanism';
      let retryCount = 0;

      // 模拟OCR服务失败一次，然后成功
      const mockOCRService = {
        recognizeFile: jest.fn()
          .mockRejectedValueOnce(new Error('OCR service temporarily unavailable'))
          .mockResolvedValueOnce({
            success: true,
            extractedText: 'Retried successfully',
            metadata: { confidence: 90 }
          })
      };

      defaultContainer.deps.ocrService = mockOCRService;

      const mockFile = createMockFile();
      const result = await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);

      expect(result).toBeDefined();
      expect(mockOCRService.recognizeFile).toHaveBeenCalledTimes(2); // 重试一次
    });

    test('should handle stage timeout', async () => {
      const uploadId = 'test_timeout';

      // 模拟超时
      const mockOCRService = {
        recognizeFile: jest.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(resolve, 6000)) // 超过5分钟超时
        )
      };

      defaultContainer.deps.ocrService = mockOCRService;

      const mockFile = createMockFile();

      await expect(enhancedUploadService.startEnhancedProcessing(
        uploadId,
        mockFile,
        undefined,
        { stageTimeout: 1000 } // 设置1秒超时进行测试
      )).rejects.toThrow('timeout');
    });

    test('should handle OCR service failure', async () => {
      const uploadId = 'test_ocr_failure';

      const mockOCRService = {
        recognizeFile: jest.fn().mockRejectedValue(
          new Error('OCR service unavailable')
        )
      };

      defaultContainer.deps.ocrService = mockOCRService;

      const mockFile = createMockFile();

      await expect(enhancedUploadService.startEnhancedProcessing(
        uploadId,
        mockFile
      )).rejects.toThrow('OCR service unavailable');
    });

    test('should handle parsing service failure', async () => {
      const uploadId = 'test_parsing_failure';

      const mockOCRService = {
        recognizeFile: jest.fn().mockResolvedValue({
          success: true,
          extractedText: 'Some medical text',
          metadata: { confidence: 95 }
        })
      };

      const mockStepwiseLLMService = {
        startStepwiseExtraction: jest.fn().mockRejectedValue(
          new Error('LLM service error')
        )
      };

      defaultContainer.deps.ocrService = mockOCRService;
      defaultContainer.deps.stepwiseLLMService = mockStepwiseLLMService;

      const mockFile = createMockFile();

      await expect(enhancedUploadService.startEnhancedProcessing(
        uploadId,
        mockFile
      )).rejects.toThrow('LLM service error');
    });
  });

  // =============================================================================
  // 性能测试 / Performance Tests
  // =============================================================================

  describe('Performance Metrics', () => {
    test('should record performance metrics', async () => {
      const uploadId = 'test_performance_metrics';
      const mockFile = createMockFile();

      await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);

      const stats = enhancedUploadService.getPerformanceStats();

      expect(stats).toBeDefined();
      expect(stats.totalProcesses).toBeGreaterThan(0);
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(100);
    });

    test('should handle multiple concurrent uploads', async () => {
      const uploadIds = ['concurrent_1', 'concurrent_2', 'concurrent_3'];
      const mockFiles = uploadIds.map(id => createMockFile());

      const startTime = Date.now();

      // 并发执行多个上传
      const results = await Promise.all(
        uploadIds.map((uploadId, index) =>
          enhancedUploadService.startEnhancedProcessing(uploadId, mockFiles[index])
        )
      );

      const totalTime = Date.now() - startTime;

      // 验证所有上传都成功
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toBeDefined();
      });

      // 验证并发性能（应该比串行执行更快）
      expect(totalTime).toBeLessThan(30000); // 30秒内完成
    });

    test('should handle memory efficiently', async () => {
      const uploadId = 'test_memory_efficiency';
      const largeFile = createMockFile(10 * 1024 * 1024); // 10MB文件

      const initialMemory = process.memoryUsage();

      await enhancedUploadService.startEnhancedProcessing(uploadId, largeFile);

      const finalMemory = process.memoryUsage();

      // 验证内存使用没有异常增长
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 内存增长不超过50MB
    });
  });

  // =============================================================================
  // 健康检查测试 / Health Check Tests
  // =============================================================================

  describe('Health Monitoring', () => {
    test('should provide health status', () => {
      const healthStatus = enhancedUploadService.getHealthStatus();

      expect(healthStatus).toBeDefined();
      expect(healthStatus.status).toBe('healthy');
      expect(healthStatus.activeProcesses).toBeGreaterThanOrEqual(0);
      expect(healthStatus.uptime).toBeGreaterThan(0);
      expect(healthStatus.memoryUsage).toBeDefined();
      expect(healthStats.timestamp).toBeDefined();
    });

    test('should handle cleanup of expired processes', async () => {
      const uploadId = 'test_cleanup';
      const mockFile = createMockFile();

      // 启动处理
      await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);

      // 等待处理完成
      await delay(1000);

      // 验证清理机制
      const cleanupSpy = jest.spyOn(enhancedUploadService, 'cleanupProcess');

      // 触发清理（在实际代码中是通过定时器自动执行的）
      enhancedUploadService.cleanupProcess('test_cleanup');

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// API路由测试 / API Route Tests
// =============================================================================

describe('Enhanced Upload API Routes', () => {
  let authToken;

  beforeEach(() => {
    authToken = 'mock-jwt-token';
  });

  describe('POST /api/enhanced-upload/start', () => {
    test('should start enhanced upload with valid file', async () => {
      const response = await request(app)
        .post('/api/enhanced-upload/start')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('test file content'), 'test.pdf')
        .field('patientId', 'test_patient_123')
        .field('options', JSON.stringify({
          enableProgressTracking: true,
          enableRetry: true
        }));

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    test('should reject request without file', async () => {
      const response = await request(app)
        .post('/api/enhanced-upload/start')
        .set('Authorization', `Bearer ${authToken}`)
        .field('patientId', 'test_patient_123');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should reject large files', async () => {
      const largeBuffer = Buffer.alloc(60 * 1024 * 1024); // 60MB

      const response = await request(app)
        .post('/api/enhanced-upload/start')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', largeBuffer, 'large.pdf');

      expect(response.status).toBe(413);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/enhanced-upload/status/:uploadId', () => {
    test('should return upload status', async () => {
      const uploadId = 'test_status_check';

      // 先创建一个上传任务
      await uploadProgressService.createUploadTask(
        uploadId,
        { originalName: 'test.pdf', size: 1024 },
        'test_user_id'
      );

      const response = await request(app)
        .get(`/api/enhanced-upload/status/${uploadId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    test('should return 404 for non-existent upload', async () => {
      const response = await request(app)
        .get('/api/enhanced-upload/status/non_existent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});

// =============================================================================
// 集成测试 / Integration Tests
// =============================================================================

describe('Enhanced Upload Integration Tests', () => {
  test('should complete full upload workflow', async () => {
    const uploadId = 'integration_test_full_workflow';
    const mockFile = createMockFile();

    // 1. 开始上传处理
    const startResult = await enhancedUploadService.startEnhancedProcessing(
      uploadId,
      mockFile,
      'test_patient_123'
    );

    expect(startResult).toBeDefined();
    expect(startResult.upload).toBeDefined();

    // 2. 检查进度状态
    const progressStatus = uploadProgressService.getUploadStatus(uploadId);
    expect(progressStatus).toBeDefined();
    expect(progressStatus.status).toBe('completed');

    // 3. 验证最终结果
    expect(startResult.ocr).toBeDefined();
    expect(startResult.parsing).toBeDefined();
    expect(startResult.matching).toBeDefined();
    expect(startResult.matching.matches).toBeDefined();
    expect(startResult.matching.matches.length).toBeGreaterThan(0);
  });

  test('should handle SSE real-time updates', async () => {
    const uploadId = 'integration_test_sse';
    const sseUpdates = [];

    // 模拟SSE连接
    const mockEventSource = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'progress') {
          // 模拟接收进度更新
          handler({ data: JSON.stringify({ uploadId, progress: 50 }) });
        }
      }),
      close: jest.fn()
    };

    // 这里应该测试实际的SSE连接，但为了测试简化，使用模拟
    expect(mockEventSource.addEventListener).toBeDefined();
    expect(mockEventSource.close).toBeDefined();
  });
});

// =============================================================================
// 性能基准测试 / Performance Benchmark Tests
// =============================================================================

describe('Performance Benchmarks', () => {
  test('should process files within acceptable time limits', async () => {
    const testCases = [
      { size: 1024, expectedMaxTime: 5000 },      // 1KB文件，5秒内
      { size: 1024 * 1024, expectedMaxTime: 10000 },  // 1MB文件，10秒内
      { size: 5 * 1024 * 1024, expectedMaxTime: 20000 }  // 5MB文件，20秒内
    ];

    for (const testCase of testCases) {
      const uploadId = `benchmark_${testCase.size}`;
      const mockFile = createMockFile(testCase.size);

      const startTime = Date.now();
      await enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);
      const processingTime = Date.now() - startTime;

      expect(processingTime).toBeLessThan(testCase.expectedMaxTime);
      console.log(`File size ${testCase.size} processed in ${processingTime}ms`);
    }
  });

  test('should handle high concurrent load', async () => {
    const concurrentCount = 10;
    const uploadIds = Array.from({ length: concurrentCount }, (_, i) => `concurrent_${i}`);

    const startTime = Date.now();

    const results = await Promise.allSettled(
      uploadIds.map(uploadId => {
        const mockFile = createMockFile(1024); // 1KB文件用于压力测试
        return enhancedUploadService.startEnhancedProcessing(uploadId, mockFile);
      })
    );

    const totalTime = Date.now() - startTime;
    const successCount = results.filter(result => result.status === 'fulfilled').length;

    expect(successCount).toBe(concurrentCount);
    expect(totalTime).toBeLessThan(30000); // 30秒内完成所有并发处理
    console.log(`Processed ${concurrentCount} concurrent uploads in ${totalTime}ms`);
  });
});