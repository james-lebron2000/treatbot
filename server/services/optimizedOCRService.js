/**
 * =============================================================================
 * 优化的OCR服务
 * Optimized OCR Service
 * =============================================================================
 * Linus哲学：性能优化要像内核调度器一样精准
 * Good taste: Performance optimization should be as precise as kernel scheduler
 * =============================================================================
 */

const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { uploadProgressService } = require('./uploadProgressService');
const logger = require('../utils/logger');
const config = require('../config');

// =============================================================================
// 类型定义和常量 / Type Definitions and Constants
// =============================================================================

const OCR_STAGES = {
  PREPROCESSING: 'preprocessing',
  TEXT_RECOGNITION: 'text_recognition',
  POSTPROCESSING: 'postprocessing',
  COMPLETE: 'complete'
};

const OPTIMIZATION_LEVELS = {
  FAST: 'fast',      // 快速模式 / Fast mode
  BALANCED: 'balanced', // 平衡模式 / Balanced mode
  QUALITY: 'quality'   // 质量模式 / Quality mode
};

const DEFAULT_OPTIMIZATION = {
  level: OPTIMIZATION_LEVELS.BALANCED,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxImageWidth: 4096,
  maxImageHeight: 4096,
  quality: 85,
  timeout: 30000 // 30秒
};

// =============================================================================
// 优化的OCR服务类 / Optimized OCR Service Class
// =============================================================================

class OptimizedOCRService {
  constructor() {
    this.processingQueue = new Map();
    this.workerPool = [];
    this.maxWorkers = 3; // 最大并发工作进程数 / Max concurrent worker processes
    this.activeWorkers = 0;
  }

  // =============================================================================
  // 核心OCR方法 / Core OCR Methods
  // =============================================================================

  /**
   * 优化的文件识别 / Optimized file recognition
   */
  async recognizeFile(filePath, fileType, template = 'general', options = {}) {
    const startTime = Date.now();
    const uploadId = options.uploadId || this.generateUploadId();
    const optimizationLevel = options.optimization || OPTIMIZATION_LEVELS.BALANCED;

    try {
      logger.info({
        filePath,
        fileType,
        template,
        optimizationLevel,
        uploadId
      }, 'Starting optimized OCR processing');

      // 更新进度：预处理开始 / Update progress: preprocessing started
      if (uploadId) {
        uploadProgressService.startStage(uploadId, 'ocr', '正在优化图像质量...');
      }

      // 阶段1：预处理 / Stage 1: Preprocessing
      const preprocessedPath = await this.preprocessImage(filePath, fileType, optimizationLevel, uploadId);

      // 阶段2：文本识别 / Stage 2: Text recognition
      const ocrResult = await this.performOCR(preprocessedPath, template, uploadId);

      // 阶段3：后处理 / Stage 3: Postprocessing
      const finalResult = await this.postprocessResults(ocrResult, uploadId);

      const processingTime = Date.now() - startTime;

      logger.info({
        uploadId,
        processingTime,
        pages: finalResult.results?.length || 0,
        averageConfidence: finalResult.averageConfidence
      }, 'Optimized OCR processing completed');

      // 清理临时文件 / Clean up temporary files
      await this.cleanupFiles([preprocessedPath]);

      return {
        success: true,
        ...finalResult,
        processingTime,
        optimizationLevel
      };

    } catch (error) {
      logger.error({
        filePath,
        uploadId,
        error: error.message
      }, 'Optimized OCR processing failed');

      // 更新进度：错误状态 / Update progress: error status
      if (uploadId) {
        uploadProgressService.failUpload(uploadId, error);
      }

      return {
        success: false,
        error: error.message || 'OCR processing failed'
      };
    }
  }

  /**
   * 图像预处理 / Image preprocessing
   */
  async preprocessImage(filePath, fileType, optimizationLevel, uploadId) {
    try {
      if (uploadId) {
        uploadProgressService.updateStageProgress(uploadId, 10, '正在预处理图像...');
      }

      const tempDir = path.join(__dirname, '../temp');
      await fs.mkdir(tempDir, { recursive: true });

      let processedPath = filePath;

      // PDF文件处理 / PDF file processing
      if (fileType === 'application/pdf') {
        processedPath = await this.convertPdfToImages(filePath, tempDir, optimizationLevel);
      }

      // 图像优化 / Image optimization
      const optimizedPath = await this.optimizeImage(processedPath, tempDir, optimizationLevel, uploadId);

      if (uploadId) {
        uploadProgressService.updateStageProgress(uploadId, 30, '图像预处理完成');
      }

      return optimizedPath;

    } catch (error) {
      logger.error({ filePath, error }, 'Image preprocessing failed');
      throw new Error(`Image preprocessing failed: ${error.message}`);
    }
  }

  /**
   * 执行OCR识别 / Perform OCR recognition
   */
  async performOCR(imagePath, template, uploadId) {
    try {
      if (uploadId) {
        uploadProgressService.startStage(uploadId, 'ocr', '正在识别文字内容...');
      }

      // 模拟OCR处理进度 / Simulate OCR processing progress
      if (uploadId) {
        let progress = 30;
        const progressInterval = setInterval(() => {
          progress += 10;
          if (progress <= 70) {
            uploadProgressService.updateStageProgress(uploadId, progress);
          } else {
            clearInterval(progressInterval);
          }
        }, 1000);
      }

      // 这里集成实际的OCR服务调用 / Integrate actual OCR service calls here
      const ocrResult = await this.callOCRService(imagePath, template);

      if (uploadId) {
        uploadProgressService.updateStageProgress(uploadId, 70, '文字识别完成');
      }

      return ocrResult;

    } catch (error) {
      logger.error({ imagePath, error }, 'OCR recognition failed');
      throw new Error(`OCR recognition failed: ${error.message}`);
    }
  }

  /**
   * 后处理结果 / Postprocess results
   */
  async postprocessResults(ocrResult, uploadId) {
    try {
      if (uploadId) {
        uploadProgressService.updateStageProgress(uploadId, 90, '正在优化识别结果...');
      }

      // 文本清理和格式化 / Text cleaning and formatting
      const cleanedResults = this.cleanTextResults(ocrResult.results);

      // 置信度计算 / Confidence calculation
      const averageConfidence = this.calculateAverageConfidence(cleanedResults);

      // 语言检测 / Language detection
      const detectedLanguage = this.detectLanguage(cleanedResults);

      const finalResult = {
        ...ocrResult,
        results: cleanedResults,
        averageConfidence,
        detectedLanguage,
        processingSteps: ['preprocessing', 'ocr', 'postprocessing']
      };

      if (uploadId) {
        uploadProgressService.updateStageProgress(uploadId, 100, 'OCR处理完成');
      }

      return finalResult;

    } catch (error) {
      logger.error({ error }, 'Postprocessing failed');
      return ocrResult; // 返回原始结果 / Return original result
    }
  }

  // =============================================================================
  // 图像优化 / Image Optimization
  // =============================================================================

  /**
   * 转换PDF到图像 / Convert PDF to images
   */
  async convertPdfToImages(pdfPath, outputDir, optimizationLevel) {
    try {
      const outputPath = path.join(outputDir, `page_%d.png`);

      // 使用pdftoppm转换PDF / Convert PDF using pdftoppm
      const args = [
        pdfPath,
        outputPath.replace('%d', ''), // 移除%d用于基础路径 / Remove %d for base path
        '-png',
        '-r', optimizationLevel === OPTIMIZATION_LEVELS.FAST ? '150' : '300'
      ];

      await this.runCommand('pdftoppm', args);

      // 返回第一页路径 / Return first page path
      return outputPath.replace('%d', '1');

    } catch (error) {
      logger.error({ pdfPath, error }, 'PDF to image conversion failed');
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }

  /**
   * 优化图像 / Optimize image
   */
  async optimizeImage(imagePath, outputDir, optimizationLevel, uploadId) {
    try {
      const filename = path.basename(imagePath, path.extname(imagePath));
      const optimizedPath = path.join(outputDir, `${filename}_optimized.png`);

      const sharpInstance = sharp(imagePath);

      // 根据优化级别设置参数 / Set parameters based on optimization level
      switch (optimizationLevel) {
        case OPTIMIZATION_LEVELS.FAST:
          sharpInstance
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .png({ quality: 70 });
          break;

        case OPTIMIZATION_LEVELS.QUALITY:
          sharpInstance
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .sharpen()
            .normalize()
            .png({ quality: 95 });
          break;

        default: // BALANCED
          sharpInstance
            .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
            .sharpen({ mild: true })
            .png({ quality: 85 });
      }

      await sharpInstance.toFile(optimizedPath);

      return optimizedPath;

    } catch (error) {
      logger.error({ imagePath, error }, 'Image optimization failed');
      return imagePath; // 返回原始路径 / Return original path
    }
  }

  // =============================================================================
  // OCR服务调用 / OCR Service Calls
  // =============================================================================

  /**
   * 调用OCR服务 / Call OCR service
   */
  async callOCRService(imagePath, template) {
    // 这里集成实际的OCR服务 / Integrate actual OCR service here
    // 目前返回模拟数据 / Currently returns mock data

    const mockResults = await this.generateMockOCRResults(imagePath, template);
    return mockResults;
  }

  /**
   * 生成模拟OCR结果 / Generate mock OCR results
   */
  async generateMockOCRResults(imagePath, template) {
    // 模拟处理时间 / Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

    const mockText = this.generateMockMedicalText(template);
    const pageCount = Math.floor(Math.random() * 5) + 1;
    const results = [];

    for (let i = 1; i <= pageCount; i++) {
      results.push({
        page: i,
        content: mockText,
        confidence: 85 + Math.random() * 10, // 85-95%置信度 / 85-95% confidence
        width: 1024,
        height: 768,
        blocks: [
          {
            text: mockText,
            confidence: 90,
            bbox: { x: 100, y: 100, width: 800, height: 600 }
          }
        ]
      });
    }

    return {
      success: true,
      results,
      totalPages: pageCount,
      averageConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length,
      processingTime: 2000 + Math.random() * 2000,
      provider: 'alibaba-ocr',
      template
    };
  }

  /**
   * 生成模拟医疗文本 / Generate mock medical text
   */
  generateMockMedicalText(template) {
    const templates = {
      medical: `患者信息：
姓名：张三
年龄：45岁
性别：男

主诉：肝区不适2个月

现病史：
患者2个月前无明显诱因出现肝区不适，呈持续性隐痛，无放射性疼痛。
无发热、黄疸、恶心、呕吐等症状。食欲略有下降，体重无明显变化。

既往史：
乙型肝炎病史10年，定期服用抗病毒药物。
无手术史，无药物过敏史。

体格检查：
T：36.5℃，P：78次/分，R：18次/分，BP：130/80mmHg
皮肤巩膜无黄染，浅表淋巴结未触及肿大。
腹平软，肝区轻压痛，肝肋下2cm，质中等，表面光滑。

辅助检查：
肝功能：ALT 85 U/L，AST 67 U/L，TBIL 23.4 μmol/L
乙肝五项：HBsAg(+)，HBeAg(+)，HBcAb(+)
HBV-DNA：3.2×10^5 IU/ml
甲胎蛋白：285 ng/ml

影像学检查：
腹部B超：肝右叶见一低回声结节，大小约3.2cm×2.8cm，边界欠清
CT增强：动脉期明显强化，门静脉期强化减弱，考虑HCC`,

      pathology: `病理检查报告
标本类型：肝穿刺活检

肉眼所见：
灰白色条索状组织3条，长0.8-1.2cm，直径0.1cm

镜下所见：
肝小叶结构破坏，肿瘤细胞排列成梁状，细胞体积大，
胞浆丰富，核大深染，核仁明显，可见核分裂象。
间质血管丰富，可见出血坏死。

免疫组化：
HepPar-1(+)，GPC-3(+)，AFP(+)，CD34血管(+)，
Ki-67阳性率约30%

病理诊断：
（肝右叶）肝细胞癌，中分化，切缘未见癌组织。`
    };

    return templates[template] || templates.medical;
  }

  // =============================================================================
  // 文本处理 / Text Processing
  // =============================================================================

  /**
   * 清理文本结果 / Clean text results
   */
  cleanTextResults(results) {
    return results.map(result => ({
      ...result,
      content: this.cleanText(result.content),
      blocks: result.blocks ? result.blocks.map(block => ({
        ...block,
        text: this.cleanText(block.text)
      })) : []
    }));
  }

  /**
   * 清理文本 / Clean text
   */
  cleanText(text) {
    return text
      .replace(/\r\n/g, '\n') // 统一换行符 / Unify line breaks
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // 移除控制字符 / Remove control characters
      .replace(/\s+/g, ' ') // 合并多余空白 / Merge excess whitespace
      .trim();
  }

  /**
   * 计算平均置信度 / Calculate average confidence
   */
  calculateAverageConfidence(results) {
    if (!results || results.length === 0) return 0;

    const totalConfidence = results.reduce((sum, result) => {
      return sum + (result.confidence || 0);
    }, 0);

    return Math.round(totalConfidence / results.length);
  }

  /**
   * 检测语言 / Detect language
   */
  detectLanguage(results) {
    const allText = results.map(r => r.content).join(' ');

    // 简单的语言检测 / Simple language detection
    const chineseChars = (allText.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishChars = (allText.match(/[a-zA-Z]/g) || []).length;

    if (chineseChars > englishChars * 2) {
      return 'zh-CN';
    } else if (englishChars > chineseChars * 2) {
      return 'en-US';
    }

    return 'mixed';
  }

  // =============================================================================
  // 工具方法 / Utility Methods
  // =============================================================================

  /**
   * 运行系统命令 / Run system command
   */
  runCommand(command, args) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });

      // 设置超时 / Set timeout
      setTimeout(() => {
        process.kill();
        reject(new Error(`Command timed out after ${DEFAULT_OPTIMIZATION.timeout}ms`));
      }, DEFAULT_OPTIMIZATION.timeout);
    });
  }

  /**
   * 清理临时文件 / Clean up temporary files
   */
  async cleanupFiles(filePaths) {
    for (const filePath of filePaths) {
      try {
        if (filePath && filePath !== '') {
          await fs.unlink(filePath);
        }
      } catch (error) {
        logger.warn({ filePath, error }, 'Failed to cleanup temporary file');
      }
    }
  }

  /**
   * 生成上传ID / Generate upload ID
   */
  generateUploadId() {
    return `ocr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取服务状态 / Get service status
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      activeWorkers: this.activeWorkers,
      queueSize: this.processingQueue.size,
      maxWorkers: this.maxWorkers,
      timestamp: new Date().toISOString()
    };
  }
}

// =============================================================================
// 创建单例实例 / Create singleton instance
// =============================================================================

const optimizedOCRService = new OptimizedOCRService();

module.exports = {
  optimizedOCRService,
  OptimizedOCRService,
  OCR_STAGES,
  OPTIMIZATION_LEVELS,
  DEFAULT_OPTIMIZATION
};