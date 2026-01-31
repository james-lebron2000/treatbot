const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ocrController = require('../controllers/ocrController');
const parsingController = require('../controllers/parsingController');
const matchingController = require('../controllers/matchingController');
const recordCRUDController = require('../controllers/recordCRUDController');
const stepwiseExtractionController = require('../controllers/stepwiseExtractionController');
const batchMatchingController = require('../controllers/batchMatchingController');
const matchHistoryController = require('../controllers/matchHistoryController');
const reportController = require('../controllers/reportController');
const reportPdfController = require('../controllers/reportPdfController');
const reportHtmlController = require('../controllers/reportHtmlController');
const asyncHandler = require('../utils/asyncHandler');
const cacheResponse = require('../middleware/cacheResponse');

const router = express.Router();

router.post('/upload', authenticateToken, upload.any(), asyncHandler(ocrController.uploadMedicalFiles));
router.post('/records/from-ocr', authenticateToken, asyncHandler(ocrController.createRecordFromOCR));
router.post('/parse', authenticateToken, asyncHandler(parsingController.parseMedicalText));
router.post('/match', authenticateToken, asyncHandler(matchingController.matchClinicalTrials));
router.post('/match/llm', authenticateToken, asyncHandler(matchingController.matchClinicalTrialsWithLLM));
// Batch/SSE matching (frontend Results page)
router.post('/match/:recordId/start', authenticateToken, asyncHandler(batchMatchingController.startMatchJob));
router.get('/match/:recordId/stream', authenticateToken, asyncHandler(batchMatchingController.streamMatchJob));
router.post('/match/:recordId/batch', authenticateToken, asyncHandler(batchMatchingController.processBatchMatch));
router.get('/match/:recordId/status', authenticateToken, asyncHandler(batchMatchingController.getBatchMatchStatus));
router.get(
  '/records',
  authenticateToken,
  cacheResponse({
    ttl: Number(process.env.RECORDS_CACHE_TTL || 120),
    keyResolver: (req) => req.userId ? `records:${req.userId}` : null,
    shouldCache: (_req, _data, meta) => (meta?.status || 200) === 200
  }),
  asyncHandler(recordCRUDController.listMedicalRecords)
);
router.get('/records/:id', authenticateToken, asyncHandler(recordCRUDController.getMedicalRecord));
router.get('/records/:id/report', authenticateToken, asyncHandler(reportController.getMatchReport));
router.get('/records/:id/report.pdf', authenticateToken, asyncHandler(reportPdfController.getMatchReportPdf));
router.get('/records/:id/report.html', authenticateToken, asyncHandler(reportHtmlController.getMatchReportHtml));
router.put('/records/:id', authenticateToken, asyncHandler(recordCRUDController.updateMedicalRecord));
router.delete('/records/:id', authenticateToken, asyncHandler(recordCRUDController.deleteMedicalRecord));
router.get('/ocr/health', asyncHandler(ocrController.ocrHealthCheck));
router.post('/integrate', authenticateToken, asyncHandler(parsingController.integrateMedicalRecord));
router.post('/extract/fields', authenticateToken, asyncHandler(parsingController.extractFieldsWithLLM));

// 分步医疗数据提取相关路由
router.post('/extract/stepwise', authenticateToken, asyncHandler(stepwiseExtractionController.startStepwiseExtraction));
router.get('/extract/status/:jobId', authenticateToken, asyncHandler(stepwiseExtractionController.getExtractionStatus));
router.get('/extract/result/:jobId', authenticateToken, asyncHandler(stepwiseExtractionController.getExtractionResult));

// 增强版临床试验匹配
router.post('/match/enhanced', authenticateToken, asyncHandler(matchingController.matchTrialsWithStructuredData));
router.get('/match/history/:recordId', authenticateToken, asyncHandler(matchHistoryController.getMatchHistory));
router.post('/match/history/:recordId/restore', authenticateToken, asyncHandler(matchHistoryController.restoreMatchHistory));

module.exports = router;
