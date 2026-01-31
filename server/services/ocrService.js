const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const os = require('os');
const { createWorker } = require('tesseract.js');
const config = require('../config');
const logger = require('../utils/logger');
const { registerQueue } = require('../queues');

const OCR_QUEUE_NAME = 'ocr-processing';
const FALLBACK_LANG = process.env.TESSERACT_LANG || 'eng';
const FALLBACK_LANG_PATH = process.env.TESSERACT_LANG_PATH;
const FALLBACK_CACHE_PATH = process.env.TESSERACT_CACHE_PATH || path.join(os.tmpdir(), 'clinical-match-tesseract');

let tesseractWorkerPromise = null;
let pdfParse = undefined;

function getPdfParse() {
  if (pdfParse !== undefined) return pdfParse;
  try {
    // Lazy-load to avoid crashing the entire server when the runtime/image
    // can't satisfy pdf-parse's optional dependencies.
    // This only affects PDF uploads; text/image matching can still work.
    // eslint-disable-next-line global-require
    pdfParse = require('pdf-parse');
    return pdfParse;
  } catch (error) {
    pdfParse = null;
    logger.warn({ err: error }, 'pdf-parse unavailable; PDF text extraction disabled');
    return null;
  }
}

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const worker = await createWorker({
        cachePath: FALLBACK_CACHE_PATH,
        langPath: FALLBACK_LANG_PATH,
        logger: (message) => {
          if (message?.status === 'recognizing text') {
            logger.debug({ progress: message.progress }, 'Tesseract fallback progress');
          }
        }
      });
      await worker.load();
      await worker.loadLanguage(FALLBACK_LANG);
      await worker.initialize(FALLBACK_LANG);
      return worker;
    })().catch((error) => {
      tesseractWorkerPromise = null;
      logger.error({ err: error }, 'Failed to initialise Tesseract worker');
      throw error;
    });
  }
  return tesseractWorkerPromise;
}

async function recognizeWithTesseract(filePath) {
  const worker = await getTesseractWorker();
  const start = Date.now();
  const { data } = await worker.recognize(filePath);
  return {
    text: (data.text || '').trim(),
    confidence: Number.isFinite(data.confidence) ? Math.round(data.confidence) : 0,
    processingTime: Date.now() - start
  };
}

function buildSuccessPayload({
  text,
  provider,
  confidence,
  processingTime,
  pages,
  isFallback
}) {
  const pageEntries = Array.isArray(pages) && pages.length
    ? pages.map((page) => ({
        page: page.page ?? 1,
        content: page.content ?? '',
        confidence: page.confidence ?? confidence ?? 0,
        error: page.error
      }))
    : [{
        page: 1,
        content: text || '',
        confidence: confidence ?? 0
      }];

  const sanitizedText = text || pageEntries.map((entry) => entry.content).join('\n').trim();

  return {
    success: true,
    extractedText: sanitizedText,
    averageConfidence: Number.isFinite(confidence) ? confidence : Math.round(
      pageEntries.reduce((sum, entry) => sum + (entry.confidence || 0), 0) / (pageEntries.length || 1)
    ),
    processingTime: Math.max(0, Number(processingTime || 0)),
    totalPages: pageEntries.length,
    provider,
    isFallback: Boolean(isFallback),
    results: pageEntries
  };
}

function buildFailurePayload(error, { provider = 'python-aliyun', isFallback = false } = {}) {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error || 'OCR processing failed'),
    provider,
    isFallback
  };
}

class AlibabaOCRService {
  constructor() {
    this.pythonOCRUrl = config.pythonOcrUrl;
    this.queue = registerQueue(
      OCR_QUEUE_NAME,
      async (job) => {
        const { filePath, fileType, template } = job.data;
        return this._processFile(filePath, fileType, template);
      },
      {
        concurrency: Number(process.env.OCR_QUEUE_CONCURRENCY || 2),
        attempts: Number(process.env.OCR_QUEUE_MAX_ATTEMPTS || 3),
        backoff: {
          type: 'exponential',
          delay: Number(process.env.OCR_QUEUE_BACKOFF_MS || 3000)
        }
      }
    );
  }

  /**
   * 预处理图片文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 处理后的图片Base64字符串
   */
  async preprocessImage(filePath) {
    try {
      // 使用 Sharp 优化图片质量
      const processedBuffer = await sharp(filePath)
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();

      return processedBuffer.toString('base64');
    } catch (error) {
      logger.error({ err: error }, 'Image preprocessing failed');
      // 如果预处理失败，直接返回原文件的 base64
      const originalBuffer = fs.readFileSync(filePath);
      return originalBuffer.toString('base64');
    }
  }

  /**
   * 调用Python OCR服务进行识别
   * @param {string} imageBase64 - 图片Base64字符串
   * @returns {Promise<Object>} OCR识别结果
   */
  async recognizeWithPythonService(imageBase64) {
    try {
      logger.debug({ endpoint: `${this.pythonOCRUrl}/ocr`, payloadBytes: imageBase64.length }, 'Calling Python OCR service');
      
      const response = await axios.post(`${this.pythonOCRUrl}/ocr`, {
        imageBase64: imageBase64
      }, {
        timeout: 30000 // 30秒超时
      });

      if (response.status !== 200) {
        throw new Error(`Python OCR service returned status ${response.status}`);
      }

      const result = response.data;
      logger.debug({
        success: result.success,
        textLength: result.extractedText ? result.extractedText.length : 0,
        confidence: result.confidence,
        requestId: result.requestId
      }, 'Python OCR service response');

      return result;
    } catch (error) {
      logger.error({ err: error }, 'Python OCR service call failed');
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Python OCR service is not running. Please start the service on port 5002.');
      }
      
      throw error;
    }
  }

  /**
   * 通过 Python OCR 服务识别文件（支持 PDF/图片）
   * Python 服务会根据文件类型决定是否需要渲染 PDF。
   */
  async recognizeFileWithPythonService(filePath, mimeType) {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: mimeType || undefined,
      });

      logger.debug({ endpoint: `${this.pythonOCRUrl}/ocr`, filePath, mimeType }, 'Calling Python OCR service with file upload');

      const response = await axios.post(`${this.pythonOCRUrl}/ocr`, form, {
        headers: form.getHeaders(),
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (response.status !== 200) {
        throw new Error(`Python OCR service returned status ${response.status}`);
      }

      return response.data;
    } catch (error) {
      logger.error({ err: error }, 'Python OCR file upload call failed');
      if (error?.code === 'ECONNREFUSED') {
        throw new Error('Python OCR service is not running. Please start the service on port 5002.');
      }
      throw error;
    }
  }

  /**
   * 主要的 OCR 识别方法
   * @param {string} filePath - 文件路径
   * @param {string} fileType - 文件类型 (image/ 或 application/pdf)
   * @param {string} template - 识别模板 ('general' 或 'medical')
   * @returns {Promise<Object>} 识别结果
   */
  async recognizeFile(filePath, fileType, template = 'general') {
    if (this.queue && this.queue.addAndWait) {
      return this.queue.addAndWait('ocr', { filePath, fileType, template });
    }
    return this._processFile(filePath, fileType, template);
  }

  async _processFile(filePath, fileType, template = 'general') {
    const normalizedType = (fileType || '').toLowerCase();
    const ext = path.extname(filePath || '').toLowerCase();

    if (normalizedType === 'text/plain' || ext === '.txt') {
      return this._processTextFile(filePath);
    }

    if (normalizedType === 'application/pdf' || ext === '.pdf') {
      return this._processPdfFile(filePath, template);
    }

    if ((normalizedType && normalizedType.startsWith('image/')) || this._isImageExtension(ext)) {
      return this._processImageFile(filePath, template);
    }

    throw new Error(`Unsupported file type: ${fileType || ext || 'unknown'}`);
  }

  _isImageExtension(ext) {
    return ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.webp', '.heic'].includes(ext);
  }

  async _processTextFile(filePath) {
    const startTime = Date.now();
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      const processingTime = Date.now() - startTime;
      const payload = buildSuccessPayload({
        text: content,
        provider: 'plain-text',
        confidence: 100,
        processingTime,
        pages: [{
          page: 1,
          content,
          confidence: 100
        }],
        isFallback: true
      });
      payload.templateType = 'plain-text';
      payload.processedAt = new Date();
      return payload;
    } catch (error) {
      logger.error({ err: error }, 'Failed to read plain text file');
      return buildFailurePayload(error, { provider: 'plain-text', isFallback: true });
    }
  }

  async _processPdfFile(filePath, template) {
    const startTime = Date.now();
    try {
      const pdfParseFn = getPdfParse();
      let text = '';
      let pageCount = 1;
      let processingTime = 0;

      if (pdfParseFn) {
        try {
          const buffer = await fsp.readFile(filePath);
          const parsed = await pdfParseFn(buffer);
          text = (parsed?.text || '').trim();
          pageCount = parsed?.numpages || parsed?.numrender || 1;
          processingTime = Date.now() - startTime;

          if (!text) {
            logger.warn({ filePath }, 'PDF parsed successfully but produced empty text');
          }
        } catch (parseError) {
          processingTime = Date.now() - startTime;
          logger.warn({ err: parseError, filePath }, 'PDF parsing failed; falling back to Python OCR');
        }
      } else {
        processingTime = Date.now() - startTime;
        logger.warn({ filePath }, 'pdf-parse unavailable; using Python OCR for PDF');
      }

      // 如果 PDF 文本可直接提取，则优先使用（速度快、成本低）
      if (text) {
        const confidence = 88;
        const payload = buildSuccessPayload({
          text,
          provider: 'pdf-parse',
          confidence,
          processingTime,
          pages: [{
            page: 1,
            content: text,
            confidence
          }],
          isFallback: true
        });
        payload.templateType = template;
        payload.processedAt = new Date();
        payload.pageCount = pageCount;
        payload.totalPages = pageCount;
        return payload;
      }

      // 扫描版 PDF：尝试调用 Python OCR（会在 Python 侧渲染 PDF 并逐页 OCR）
      try {
        const pythonResult = await this.recognizeFileWithPythonService(filePath, 'application/pdf');
        const pythonText = (pythonResult?.extractedText || '').trim();
        const pythonConfidence = Number.isFinite(pythonResult?.confidence) ? Math.round(pythonResult.confidence) : 0;
        const pythonPages = Array.isArray(pythonResult?.pages)
          ? pythonResult.pages.map((p, idx) => ({
              page: Number(p?.page || idx + 1),
              content: String(p?.extractedText || ''),
              confidence: Number.isFinite(p?.confidence) ? Math.round(p.confidence) : pythonConfidence,
              error: p?.error
            }))
          : [{
              page: 1,
              content: pythonText,
              confidence: pythonConfidence
            }];

        if (pythonResult?.success && pythonText) {
          const totalPages = Number(pythonResult?.totalPages || pythonResult?.processedPages || pageCount || 1);
          const payload = buildSuccessPayload({
            text: pythonText,
            provider: 'python-aliyun',
            confidence: pythonConfidence,
            processingTime: Date.now() - startTime,
            pages: pythonPages,
            isFallback: false
          });
          payload.templateType = template;
          payload.processedAt = new Date();
          payload.pageCount = totalPages;
          payload.totalPages = totalPages;
          payload.warning = pythonResult?.warning;
          return payload;
        }

        logger.warn({ filePath, warning: pythonResult?.warning }, 'Python OCR returned empty result for PDF; falling back to pdf-parse empty result');
      } catch (pythonError) {
        logger.warn({ err: pythonError, filePath }, 'Python OCR for PDF failed; falling back to pdf-parse empty result');
      }

      // 最终兜底：没有得到任何文本，返回失败（避免前端“上传成功但无法进入下一步”）
      const reason = pdfParseFn
        ? 'PDF 未识别到可提取文本，建议使用扫描版 PDF OCR 或将页面导出为图片后上传'
        : 'PDF OCR 服务未返回有效文本，请稍后重试或将页面导出为图片后上传';
      return buildFailurePayload(new Error(reason), { provider: pdfParseFn ? 'pdf-parse' : 'python-aliyun', isFallback: true });
    } catch (error) {
      logger.error({ err: error, filePath }, 'PDF extraction failed');
      return buildFailurePayload(error, { provider: 'pdf-parse', isFallback: true });
    }
  }

  async _processImageFile(filePath, template) {
    const startTime = Date.now();
    let pythonResult = null;

    try {
      const preprocessed = await this.preprocessImage(filePath);
      pythonResult = await this._processWithPython([preprocessed], template, startTime);

      if (pythonResult.success && pythonResult.extractedText.trim()) {
        return pythonResult;
      }

      if (config.ocr?.allowTesseractFallback) {
        logger.warn({
          filePath,
          reason: pythonResult?.error || 'empty result'
        }, 'Python OCR returned empty result, attempting tesseract fallback');
      }
    } catch (error) {
      logger.warn({ err: error, filePath }, 'Python OCR pipeline failed, using fallback');
      pythonResult = buildFailurePayload(error, { provider: 'python-aliyun' });
    }

    if (config.ocr?.allowTesseractFallback) {
      const fallback = await this._processImageWithTesseract(filePath, template);
      if (fallback.success) {
        fallback.upstreamProvider = pythonResult?.provider || 'python-aliyun';
        fallback.upstreamError = pythonResult?.error;
        return fallback;
      }
      return pythonResult;
    }

    return pythonResult;
  }

  async _processWithPython(imageBase64Array, template, startTime) {
    const results = [];
    let totalConfidence = 0;
    let successCount = 0;

    for (let index = 0; index < imageBase64Array.length; index += 1) {
      const imageBase64 = imageBase64Array[index];
      try {
        const result = await this.recognizeWithPythonService(imageBase64);
        if (result && result.success) {
          results.push({
            page: index + 1,
            content: result.extractedText || '',
            confidence: result.confidence || 0
          });
          totalConfidence += result.confidence || 0;
          successCount += 1;
        } else {
          const resultError = result && result.error ? result.error : 'Python OCR returned invalid response';
          logger.error({ page: index + 1, err: resultError }, 'Python OCR returned failure');
          results.push({
            page: index + 1,
            content: '',
            confidence: 0,
            error: resultError
          });
        }
      } catch (error) {
        logger.error({ page: index + 1, err: error }, 'Python OCR threw during page processing');
        results.push({
          page: index + 1,
          content: '',
          confidence: 0,
            error: error.message
          });
      }
    }

    const combinedText = results.map((entry) => entry.content).filter(Boolean).join('\n\n').trim();
    const processingTime = Date.now() - startTime;
    if (combinedText.length > 0) {
      return buildSuccessPayload({
        text: combinedText,
        provider: 'python-aliyun',
        confidence: successCount > 0 ? Math.round(totalConfidence / successCount) : 0,
        processingTime,
        pages: results,
        isFallback: false
      });
    }

    return buildFailurePayload(new Error('Python OCR returned no text'), { provider: 'python-aliyun' });
  }

  async _processImageWithTesseract(filePath, template) {
    try {
      const fallbackResult = await recognizeWithTesseract(filePath);
      if (fallbackResult.text) {
        const payload = buildSuccessPayload({
          text: fallbackResult.text,
          provider: 'tesseract.js',
          confidence: fallbackResult.confidence,
          processingTime: fallbackResult.processingTime,
          pages: [{
            page: 1,
            content: fallbackResult.text,
            confidence: fallbackResult.confidence
          }],
          isFallback: true
        });
        payload.templateType = template;
        payload.processedAt = new Date();
        return payload;
      }
      return buildFailurePayload(new Error('Tesseract fallback produced empty text'), { provider: 'tesseract.js', isFallback: true });
    } catch (error) {
      logger.error({ err: error, filePath }, 'Tesseract fallback failed');
      return buildFailurePayload(error, { provider: 'tesseract.js', isFallback: true });
    }
  }
}

module.exports = AlibabaOCRService;
