const { z } = require('zod');

const resultEnum = z.enum(['满足', '不满足', '可能不满足', '不确定']);

const checkSchema = z.object({
  criterion: z.string().trim().min(1, 'criterion is required'),
  patient_value: z.string().trim().min(1, 'patient_value is required'),
  result: resultEnum
});

const summarySchema = z.object({
  inclusion_met: z.array(z.string().trim()).default([]),
  exclusion_triggered: z.array(z.string().trim()).default([]),
  uncertain: z.array(z.string().trim()).default([])
});

const matchSchema = z.object({
  trial_id: z.string().trim().min(1, 'trial_id is required'),
  trial_title: z.string().trim().min(1, 'trial_title is required'),
  match_score: z.number().min(0).max(100),
  inclusion_checks: z.array(checkSchema).default([]),
  exclusion_checks: z.array(checkSchema).default([]),
  summary: summarySchema,
  rank_reason: z.string().trim().max(512).optional(),
  trial_metadata: z.any().optional()
});

const matchArraySchema = z.array(matchSchema);

function validateMatchResult(entry, context = 'unknown') {
  const parsed = matchSchema.safeParse(entry);
  if (!parsed.success) {
    const issue = parsed.error.issues?.[0];
    const message = issue
      ? `Invalid match result (${context}): ${issue.path.join('.') || '<root>'} ${issue.message}`
      : `Invalid match result (${context})`;
    const error = new Error(message);
    error.details = parsed.error;
    throw error;
  }
  return parsed.data;
}

function validateMatchResults(entries, context = 'unknown') {
  const parsed = matchArraySchema.safeParse(entries);
  if (!parsed.success) {
    const issue = parsed.error.issues?.[0];
    const message = issue
      ? `Invalid match results (${context}): [${issue.path.join('.')}] ${issue.message}`
      : `Invalid match results (${context})`;
    const error = new Error(message);
    error.details = parsed.error;
    throw error;
  }
  return parsed.data;
}

module.exports = {
  validateMatchResult,
  validateMatchResults,
  matchSchema,
  matchArraySchema
};

