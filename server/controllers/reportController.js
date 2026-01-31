const mongoose = require('mongoose');
const { MedicalRecord } = require('../models');
const { BadRequestError, NotFoundError } = require('../utils/httpError');

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toIso(value) {
  try {
    return value ? new Date(value).toISOString() : null;
  } catch {
    return null;
  }
}

function summarizeMatch(match) {
  const title = safeText(match?.trial_title || match?.trial_metadata?.title || match?.trial_id);
  const score = Number(match?.match_score ?? match?.matchScore ?? 0);
  const location = safeText(match?.trial_metadata?.location || match?.trial_metadata?.city || match?.trial_metadata?.province || '');
  const phase = safeText(match?.trial_metadata?.phase || '');
  const status = safeText(match?.trial_metadata?.status || '');

  const inclusion = Array.isArray(match?.summary?.inclusion_met) ? match.summary.inclusion_met.slice(0, 5) : [];
  const exclusion = Array.isArray(match?.summary?.exclusion_triggered) ? match.summary.exclusion_triggered.slice(0, 5) : [];
  const uncertain = Array.isArray(match?.summary?.uncertain) ? match.summary.uncertain.slice(0, 5) : [];

  return {
    trial_id: safeText(match?.trial_id),
    trial_title: title,
    match_score: Number.isFinite(score) ? score : 0,
    trial_metadata: {
      location: location || undefined,
      phase: phase || undefined,
      status: status || undefined,
      sponsor: safeText(match?.trial_metadata?.sponsor || '') || undefined,
      condition: safeText(match?.trial_metadata?.condition || '') || undefined
    },
    explanation: {
      inclusion_met: inclusion,
      exclusion_triggered: exclusion,
      uncertain
    },
    rank_reason: safeText(match?.rank_reason || '') || undefined
  };
}

function buildPatientSummary(record) {
  const structured = record?.structuredData || {};
  const archive = record?.clinicalArchive || null;
  const llm = record?.llmIntegrationData?.fullStructuredData || null;

  // MVP: return both legacy structured + archive pointer so frontend can choose.
  return {
    recordId: record?._id ? String(record._id) : null,
    uploadedAt: toIso(record?.uploadDate) || null,
    originalFileName: safeText(record?.originalFileName || '') || null,
    extractedTextPreview: safeText(record?.extractedText || '').slice(0, 4000),
    structuredData: structured,
    clinicalArchive: archive,
    llmStructuredData: llm,
    dataQuality: record?.matchMetadata?.dataQuality || record?.llmIntegrationData?.metadata?.dataQuality || null
  };
}

async function getMatchReport(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: id, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const matches = Array.isArray(record.matchResults) ? record.matchResults : [];
    const provider = record.matchMetadata || null;

    const topMatches = matches
      .slice()
      .sort((a, b) => (Number(b?.match_score ?? 0) - Number(a?.match_score ?? 0)))
      .slice(0, Number(process.env.LLM_MATCH_MAX_RESULTS || 15))
      .map(summarizeMatch);

    const report = {
      version: 'mvp-report-v1',
      generatedAt: new Date().toISOString(),
      patientSummary: buildPatientSummary(record),
      matchingSummary: {
        provider: provider,
        matchCount: matches.length,
        topCount: topMatches.length,
        missingChecklist: provider?.missingChecklist || null
      },
      recommendedTrials: topMatches
    };

    return res.success({ report }, { message: 'Match report generated' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMatchReport
};
