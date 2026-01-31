/**
 * RecordProcessingService Unit Tests
 */

const RecordProcessingService = require('../../../services/recordProcessing/RecordProcessingService');
const { createMockOCRResult, createMockLLMResult } = require('../../setup');

// Mock dependencies
const mockOCRService = {
  recognizeFile: jest.fn()
};

const mockLLMService = {
  integrateMedicalRecord: jest.fn(),
  extractMedicalFields: jest.fn()
};

const mockStepwiseLLMService = {
  startStepwiseExtraction: jest.fn(),
  getExtractionStatus: jest.fn(),
  getStructuredResult: jest.fn()
};

const mockMedicalRecord = {};
const mockPatient = {};
const mockCacheService = {
  del: jest.fn(),
  get: jest.fn(),
  set: jest.fn()
};

describe('RecordProcessingService', () => {
  let service;

  beforeEach(() => {
    service = new RecordProcessingService({
      ocrService: mockOCRService,
      llmService: mockLLMService,
      stepwiseLLMService: mockStepwiseLLMService,
      MedicalRecord: mockMedicalRecord,
      Patient: mockPatient,
      cacheService: mockCacheService
    });

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('extractTextFromFile', () => {
    it('should successfully extract text from file', async () => {
      const mockFile = {
        mimetype: 'image/jpeg',
        path: '/tmp/test.jpg',
        originalname: 'test.jpg'
      };

      const mockOCRResult = createMockOCRResult({
        results: [
          { content: 'Page 1 content' },
          { content: 'Page 2 content' }
        ]
      });

      mockOCRService.recognizeFile.mockResolvedValue(mockOCRResult);

      const result = await service.extractTextFromFile(mockFile, 'general');

      expect(result.success).toBe(true);
      expect(result.extractedText).toContain('Page 1 content');
      expect(result.extractedText).toContain('Page 2 content');
      expect(result.metadata.confidence).toBe(95);
      expect(mockOCRService.recognizeFile).toHaveBeenCalledWith(
        mockFile.path,
        mockFile.mimetype,
        'general'
      );
    });

    it('should handle OCR failure gracefully', async () => {
      const mockFile = {
        mimetype: 'image/jpeg',
        path: '/tmp/test.jpg',
        originalname: 'test.jpg'
      };

      mockOCRService.recognizeFile.mockResolvedValue({
        success: false,
        error: 'OCR service unavailable'
      });

      const result = await service.extractTextFromFile(mockFile, 'general');

      expect(result.success).toBe(false);
      expect(result.error).toBe('OCR service unavailable');
    });

    it('should handle exceptions during OCR', async () => {
      const mockFile = {
        mimetype: 'image/jpeg',
        path: '/tmp/test.jpg',
        originalname: 'test.jpg'
      };

      mockOCRService.recognizeFile.mockRejectedValue(new Error('Network error'));

      const result = await service.extractTextFromFile(mockFile, 'general');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('processUploadedFiles', () => {
    it('should process multiple files successfully', async () => {
      const mockFiles = [
        {
          mimetype: 'image/jpeg',
          path: '/tmp/test1.jpg',
          originalname: 'test1.jpg',
          filename: 'file1'
        },
        {
          mimetype: 'image/jpeg',
          path: '/tmp/test2.jpg',
          originalname: 'test2.jpg',
          filename: 'file2'
        }
      ];

      mockOCRService.recognizeFile.mockResolvedValue(createMockOCRResult());

      const result = await service.processUploadedFiles(mockFiles);

      expect(result.stats.successCount).toBe(2);
      expect(result.stats.failCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.combinedText).toContain('test1.jpg');
      expect(result.combinedText).toContain('test2.jpg');
    });

    it('should handle partial failures', async () => {
      const mockFiles = [
        {
          mimetype: 'image/jpeg',
          path: '/tmp/test1.jpg',
          originalname: 'test1.jpg',
          filename: 'file1'
        },
        {
          mimetype: 'image/jpeg',
          path: '/tmp/test2.jpg',
          originalname: 'test2.jpg',
          filename: 'file2'
        }
      ];

      mockOCRService.recognizeFile
        .mockResolvedValueOnce(createMockOCRResult())
        .mockResolvedValueOnce({ success: false, error: 'OCR failed' });

      const result = await service.processUploadedFiles(mockFiles);

      expect(result.stats.successCount).toBe(1);
      expect(result.stats.failCount).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('OCR failed');
    });
  });

  describe('parseTextToStructured', () => {
    it('should parse text using LLM when enabled', async () => {
      const mockText = '患者，男，65岁，诊断为肝细胞癌';
      const mockLLMResult = createMockLLMResult();

      mockLLMService.integrateMedicalRecord.mockResolvedValue(mockLLMResult);

      const result = await service.parseTextToStructured(mockText, { useLLM: true });

      expect(result.structuredData).toBeDefined();
      expect(result.structuredData.age).toBe(65);
      expect(result.structuredData.gender).toBe('male');
      expect(result.llmIntegrationData).toBeDefined();
      expect(mockLLMService.integrateMedicalRecord).toHaveBeenCalledWith(mockText);
    });

    it('should fall back to heuristic parsing when LLM disabled', async () => {
      const mockText = '患者，男，65岁，诊断为肝细胞癌';

      const result = await service.parseTextToStructured(mockText, { useLLM: false });

      expect(result.structuredData).toBeDefined();
      expect(result.structuredData.age).toBe(65);
      expect(result.structuredData.gender).toBe('male');
      expect(result.llmIntegrationData).toBeNull();
      expect(mockLLMService.integrateMedicalRecord).not.toHaveBeenCalled();
    });

    it('should fall back to heuristic parsing when LLM fails', async () => {
      const mockText = '患者，男，65岁，诊断为肝细胞癌';

      mockLLMService.integrateMedicalRecord.mockRejectedValue(new Error('LLM error'));

      const result = await service.parseTextToStructured(mockText, { useLLM: true });

      expect(result.structuredData).toBeDefined();
      expect(result.llmIntegrationData).toBeNull();
    });
  });

  describe('extractSpecificFields', () => {
    it('should extract specific fields using LLM', async () => {
      const mockText = 'Test medical text';
      const mockFields = ['diagnosis', 'age', 'gender'];

      mockLLMService.extractMedicalFields.mockResolvedValue({
        success: true,
        entries: [
          { field: 'diagnosis', value: 'Test diagnosis' },
          { field: 'age', value: 65 }
        ],
        structuredData: {
          diagnosis: 'Test diagnosis',
          age: 65
        },
        metadata: {
          provider: 'test-llm'
        }
      });

      const result = await service.extractSpecificFields(mockText, mockFields);

      expect(result.success).toBe(true);
      expect(result.entries).toHaveLength(2);
      expect(result.structuredData.diagnosis).toBe('Test diagnosis');
      expect(mockLLMService.extractMedicalFields).toHaveBeenCalledWith(mockText, mockFields);
    });
  });

  describe('integrateMedicalRecord', () => {
    it('should integrate medical record with LLM', async () => {
      const mockText = 'Test medical text';
      const mockLLMResult = createMockLLMResult();

      mockLLMService.integrateMedicalRecord.mockResolvedValue(mockLLMResult);

      const result = await service.integrateMedicalRecord(mockText);

      expect(result.correctedText).toBe('Corrected medical text');
      expect(result.structuredData).toBeDefined();
      expect(result.metadata).toBeDefined();
    });

    it('should throw error when LLM integration fails', async () => {
      const mockText = 'Test medical text';

      mockLLMService.integrateMedicalRecord.mockResolvedValue({
        success: false,
        error: 'Integration failed'
      });

      await expect(service.integrateMedicalRecord(mockText)).rejects.toThrow(
        'LLM integration failed'
      );
    });
  });

  describe('stepwise extraction methods', () => {
    it('should start stepwise extraction', async () => {
      const mockText = 'Test text';
      const mockPatientId = 'patient123';
      const mockOptions = { recordId: 'record123' };

      mockStepwiseLLMService.startStepwiseExtraction.mockResolvedValue({
        jobId: 'job123',
        status: 'started'
      });

      const result = await service.startStepwiseExtraction(mockText, mockPatientId, mockOptions);

      expect(result.jobId).toBe('job123');
      expect(mockStepwiseLLMService.startStepwiseExtraction).toHaveBeenCalledWith(
        mockText,
        mockPatientId,
        mockOptions
      );
    });

    it('should get extraction status', async () => {
      const mockJobId = 'job123';

      mockStepwiseLLMService.getExtractionStatus.mockResolvedValue({
        status: 'in_progress',
        progress: 50
      });

      const result = await service.getExtractionStatus(mockJobId);

      expect(result.status).toBe('in_progress');
      expect(mockStepwiseLLMService.getExtractionStatus).toHaveBeenCalledWith(mockJobId);
    });

    it('should get extraction result', async () => {
      const mockJobId = 'job123';

      mockStepwiseLLMService.getStructuredResult.mockResolvedValue({
        structuredData: { diagnosis: 'Test' },
        metadata: {}
      });

      const result = await service.getExtractionResult(mockJobId);

      expect(result.structuredData).toBeDefined();
      expect(mockStepwiseLLMService.getStructuredResult).toHaveBeenCalledWith(mockJobId);
    });
  });

  describe('checkOCRHealth', () => {
    it('should return health status', async () => {
      const result = await service.checkOCRHealth();

      expect(result.status).toBe('healthy');
      expect(result.ocrService).toBe('alibaba-cloud');
      expect(result.timestamp).toBeDefined();
    });
  });
});
