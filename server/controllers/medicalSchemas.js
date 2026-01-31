const { z } = require('zod');

const MATCH_MAX_RESULTS = Number(process.env.MATCH_MAX_RESULTS || 50);

function limitMatchResults(matches) {
  const limit = Number.isFinite(MATCH_MAX_RESULTS)
    ? Math.max(1, Math.min(500, Math.floor(MATCH_MAX_RESULTS)))
    : 50;
  if (!Array.isArray(matches)) return [];
  return matches.slice(0, limit);
}

const textParseSchema = z.object({
  text: z.string().trim().min(1),
  fileId: z.string().optional(),
  useLLM: z.boolean().optional(),
  patientId: z.string().optional(),
  recordId: z.string().optional(),
  ocrMetadata: z.record(z.any()).optional(),
  results: z.array(z.object({
    fileName: z.string(),
    fileId: z.string(),
    ocrMetadata: z.object({
      provider: z.string(),
      confidence: z.number().optional(),
      processingTime: z.number().optional(),
      templateType: z.string().optional(),
      pageCount: z.number().optional(),
      isFallback: z.boolean().optional()
    })
  })).optional(),
  overallMetadata: z.object({
    providers: z.array(z.string()),
    averageConfidence: z.number().nullable().optional(),
    totalProcessingTime: z.number().optional(),
    totalPageCount: z.number().optional(),
    processedAt: z.string().or(z.date()).optional(),
    isFallback: z.boolean().optional()
  }).optional()
});

const fieldConfigSchema = z.object({
  key: z.string().trim().min(1),
  prompt: z.string().trim().optional(),
  type: z.enum(['string', 'number', 'boolean', 'array']).optional()
});

const fieldExtractionSchema = z.object({
  text: z.string().trim().min(1),
  fields: z.array(z.union([z.string().trim().min(1), fieldConfigSchema])).optional(),
  recordId: z.string().trim().optional(),
  patientId: z.string().trim().optional()
});

const ocrRecordSchema = z.object({
  text: z.string().trim().min(1),
  patientId: z.string().optional(),
  fileId: z.string().optional(),
  ocrMetadata: z.object({}).passthrough().optional(),
  results: z.array(z.object({
    fileName: z.string(),
    fileId: z.string().optional(),
    ocrMetadata: z.object({}).passthrough().optional()
  })).optional(),
  overallMetadata: z.object({}).passthrough().optional()
});

const matchSchema = z.object({
  recordId: z.string().trim().min(1).optional(),
  record: z.object({}).passthrough().optional()
}).refine((data) => data.recordId || data.record, {
  message: 'recordId or record must be provided'
});

const trialStatusSchema = z.enum(['recruiting', 'active', 'completed', 'suspended']);

const geoFilterSchema = z.object({
  mode: z.enum(['national', 'province', 'city', 'region']).optional(),
  provinces: z.array(z.string().trim().min(1)).optional(),
  cities: z.array(z.string().trim().min(1)).optional(),
  // For mode=region: 华东/华北/华南/华中/东北/西南/西北
  regions: z.array(z.string().trim().min(1)).optional(),
  includeNeighbors: z.boolean().optional()
}).optional();

const matchFiltersSchema = z.object({
  geo: geoFilterSchema.optional(),
  statuses: z.array(trialStatusSchema).optional()
}).optional();

const matchRequestSchema = z.object({
  recordId: z.string().trim().min(1).optional(),
  record: z.object({}).passthrough().optional(),
  filters: matchFiltersSchema.optional()
}).refine((data) => data.recordId || data.record, {
  message: 'recordId or record must be provided'
});

const enhancedMatchRequestSchema = z.object({
  structuredData: z.object({}).passthrough().optional(),
  patientId: z.string().optional(),
  jobId: z.string().optional(),
  useHybridMatching: z.boolean().optional(),
  filters: matchFiltersSchema.optional()
});

const recordUpdateSchema = z.object({
  extractedText: z.string().optional(),
  structuredData: z.object({}).passthrough().optional(),
  llmIntegrationData: z.object({}).passthrough().optional(),
  ocrMetadata: z.record(z.any()).optional(),
  patientId: z.union([z.string().trim().min(1), z.null()]).optional()
}).refine((payload) => Object.keys(payload).length > 0, {
  message: 'At least one field must be provided for update'
});

module.exports = {
  limitMatchResults,
  textParseSchema,
  fieldExtractionSchema,
  ocrRecordSchema,
  matchSchema,
  trialStatusSchema,
  geoFilterSchema,
  matchFiltersSchema,
  matchRequestSchema,
  enhancedMatchRequestSchema,
  recordUpdateSchema
};
