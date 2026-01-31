const mongoose = require('mongoose');
const { z } = require('zod');
const { Patient, MedicalRecord } = require('../models');
const LLMIntegrationService = require('../services/llmIntegrationService');
const TrialMatchingService = require('../services/trialMatchingService');
const { computeClassicMatches } = require('../utils/matching');
const { normaliseRecordForMatching } = require('../utils/patientDataNormalizer');
const { prefilterTrials } = require('../utils/trialPrefilter');
const trialCache = require('../services/trialCache');
const logger = require('../utils/logger');
const { HttpError, BadRequestError, NotFoundError } = require('../utils/httpError');
const { mapClassicMatchesToEnhanced, saveMatchSnapshot } = require('../services/matchEngineService');

const llmService = new LLMIntegrationService();
const matchService = new TrialMatchingService();

function normalizeGenderInput(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return undefined;

  const normalized = raw.toLowerCase();

  if (['male', 'm', 'man', '男', '男性'].includes(normalized)) return 'male';
  if (['female', 'f', 'woman', '女', '女性'].includes(normalized)) return 'female';
  if (['other', 'unknown', 'u', '其他', '未知', '不详'].includes(normalized)) return 'other';

  return raw;
}

function buildTrialLookup(trials = []) {
  return new Map(trials.map((trial) => [trial.trialId, trial]));
}

function attachMetadata(matches = [], trialLookup = new Map()) {
  return matches.map((match) => {
    if (match.trial_metadata) {
      return match;
    }
    const metadata = trialLookup.get(match.trial_id);
    if (!metadata) {
      return match;
    }
    const { rawSource, ...rest } = metadata;
    return {
      ...match,
      trial_metadata: { ...rest, trialId: metadata.trialId }
    };
  });
}

const contactInfoSchema = z.object({
  email: z.string().trim().email().or(z.literal('')).optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional()
}).optional();

const createPatientSchema = z.object({
  name: z.string().trim().min(1),
  gender: z.preprocess(normalizeGenderInput, z.enum(['male', 'female', 'other']).optional()),
  dob: z.coerce.date().optional(),
  notes: z.string().trim().optional(),
  tags: z.array(z.string().trim()).optional(),
  contactInfo: contactInfoSchema.default({})
});

const updatePatientSchema = z.object({
  name: z.string().trim().optional(),
  patientId: z.string().trim().optional(),
  gender: z.preprocess(normalizeGenderInput, z.enum(['male', 'female', 'other']).optional()),
  dob: z.coerce.date().optional(),
  notes: z.string().trim().optional(),
  tags: z.array(z.string().trim()).optional(),
  contactInfo: contactInfoSchema
}).refine((val) => Object.keys(val).length > 0, {
  message: '至少提供一个需要更新的字段'
});

const attachRecordSchema = z.object({
  recordId: z.string().trim().min(1)
});

function transformPatient(doc, recordCount = 0) {
  if (!doc) return null;
  const contactInfo = doc.contactInfo || {};
  return {
    id: doc._id?.toString?.() || doc.id,
    patientId: doc.patientId || doc.code,
    name: doc.name,
    gender: doc.gender,
    contactInfo: {
      email: contactInfo.email || undefined,
      phone: contactInfo.phone || undefined,
      address: contactInfo.address || undefined
    },
    dob: doc.dob || null,
    notes: doc.notes || '',
    tags: doc.tags || [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    latestRecordId: doc.latestRecordId ? doc.latestRecordId.toString() : null,
    latestStructuredData: doc.latestStructuredData || null,
    latestClinicalArchive: doc.latestClinicalArchive || null,
    hasStructuredRecord: Boolean(doc.latestStructuredData || doc.latestClinicalArchive),
    recordCount
  };
}

async function listPatients(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.userId)) {
      throw new BadRequestError('Invalid user session');
    }

    const userObjectId = new mongoose.Types.ObjectId(req.userId);

    const [patients, recordStats] = await Promise.all([
      Patient.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean(),
      MedicalRecord.aggregate([
        { $match: { userId: userObjectId } },
        { $group: { _id: '$patientId', total: { $sum: 1 } } }
      ])
    ]);

    const recordMap = recordStats.reduce((acc, entry) => {
      if (entry._id) {
        acc[entry._id.toString()] = entry.total;
      }
      return acc;
    }, {});

    const transformed = patients.map((patient) => {
      const recordCount = recordMap[patient._id?.toString()] || 0;
      return transformPatient(patient, recordCount);
    });

    logger.debug({ userId: req.userId, count: transformed.length }, 'Loaded patient list');

    return res.success({ patients: transformed }, { message: 'Patients retrieved' });
  } catch (error) {
    return next(error);
  }
}

async function createPatient(req, res, next) {
  try {
    const payload = createPatientSchema.parse(req.body || {});
    
    // Generate patient ID based on user's patient count + 1
    const patientCount = await Patient.countDocuments({ userId: req.userId });
    const generatedPatientId = `P${String(patientCount + 1).padStart(4, '0')}`;
    
    // Ensure uniqueness (in case of concurrent requests)
    let candidateId = generatedPatientId;
    let suffix = 1;
    while (await Patient.exists({ userId: req.userId, patientId: candidateId })) {
      candidateId = `P${String(patientCount + suffix + 1).padStart(4, '0')}`;
      suffix += 1;
      if (suffix > 100) {
        throw new HttpError(409, 'Unable to generate unique patient ID', { code: 'patient_id_conflict' });
      }
    }

    const patient = new Patient({
      userId: req.userId,
      patientId: candidateId,
      name: payload.name,
      gender: payload.gender ?? undefined,
      dob: payload.dob,
      notes: payload.notes,
      tags: payload.tags,
      contactInfo: payload.contactInfo || {}
    });
    await patient.save();

    logger.info({ userId: req.userId, patientId: patient._id, generatedId: candidateId }, 'Patient created with auto-generated ID');

    return res.success({
      generatedPatientId: candidateId,
      patient: transformPatient(patient, 0)
    }, {
      status: 201,
      message: `Patient created with ID: ${candidateId}`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    if (error && typeof error === 'object' && error.name === 'ValidationError') {
      return next(new BadRequestError('患者信息校验失败', { details: error.errors || error }));
    }
    return next(error);
  }
}

async function getPatient(req, res, next) {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!patient) {
      throw new NotFoundError('Not found');
    }
    const [record, recordCount] = await Promise.all([
      MedicalRecord.findOne({ userId: req.userId, patientId: patient._id }).sort({ uploadDate: -1 }).lean(),
      MedicalRecord.countDocuments({ userId: req.userId, patientId: patient._id })
    ]);

    return res.success({
      patient: transformPatient(patient, recordCount),
      latestRecord: record || null
    }, { message: 'Patient retrieved' });
  } catch (error) {
    return next(error);
  }
}

async function updatePatient(req, res, next) {
  try {
    const updates = updatePatientSchema.parse(req.body || {});
    const updatePayload = {
      ...updates,
      ...(updates.contactInfo ? { contactInfo: updates.contactInfo } : {})
    };

    const patient = await Patient.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: updatePayload, $currentDate: { updatedAt: true } },
      { new: true }
    );
    if (!patient) {
      throw new NotFoundError('Not found');
    }
    const recordCount = await MedicalRecord.countDocuments({ userId: req.userId, patientId: patient._id });
    return res.success({ patient: transformPatient(patient, recordCount) }, { message: 'Updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    if (error && typeof error === 'object' && error.name === 'ValidationError') {
      return next(new BadRequestError('患者信息校验失败', { details: error.errors || error }));
    }
    return next(error);
  }
}

async function deletePatient(req, res, next) {
  try {
    const patient = await Patient.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!patient) {
      throw new NotFoundError('Not found');
    }
    await MedicalRecord.updateMany({ userId: req.userId, patientId: patient._id }, { $unset: { patientId: 1 } });
    logger.info({ userId: req.userId, patientId: req.params.id }, 'Patient deleted');
    return res.success({}, { message: 'Deleted' });
  } catch (error) {
    return next(error);
  }
}

async function listPatientRecords(req, res, next) {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, userId: req.userId });
    if (!patient) {
      throw new NotFoundError('未找到患者');
    }

    const records = await MedicalRecord.find({ userId: req.userId, patientId: patient._id })
      .sort({ uploadDate: -1 });

    return res.success({ records }, { message: 'Records retrieved' });
  } catch (error) {
    return next(error);
  }
}

async function attachMedicalRecord(req, res, next) {
  try {
    const { recordId } = attachRecordSchema.parse(req.body || {});
    const patient = await Patient.findOne({ _id: req.params.id, userId: req.userId });
    if (!patient) {
      throw new NotFoundError('未找到患者');
    }
    const record = await MedicalRecord.findOne({ _id: recordId, userId: req.userId });
    if (!record) {
      throw new NotFoundError('未找到病历');
    }
    record.patientId = patient._id;
    await record.save();
    return res.success({ recordId: record._id, patientId: patient._id }, { message: '已关联' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function integratePatientRecord(req, res, next) {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, userId: req.userId });
    if (!patient) {
      throw new NotFoundError('未找到患者');
    }

    let baseText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!baseText) {
      const latestRecord = await MedicalRecord.findOne({ userId: req.userId, patientId: patient._id }).sort({ uploadDate: -1 });
      if (latestRecord?.extractedText) {
        baseText = latestRecord.extractedText;
      }
    }

    if (!baseText) {
      throw new BadRequestError('无可用病历文本，请先上传病历');
    }

    const integration = await llmService.integrateMedicalRecord(baseText);
    if (!integration.success) {
      throw new HttpError(502, 'LLM 整合失败', {
        code: 'llm_integration_failed',
        details: integration.metadata?.errorMessage || integration.error || 'unknown'
      });
    }

    let record = await MedicalRecord.findOne({ userId: req.userId, patientId: patient._id }).sort({ uploadDate: -1 });
    if (!record) {
      record = new MedicalRecord({
        userId: req.userId,
        patientId: patient._id,
        extractedText: baseText,
        originalFileName: 'patient_text'
      });
    }
    record.llmIntegrationData = {
      correctedText: integration.correctedText,
      fullStructuredData: integration.structuredData,
      timeline: integration.timeline,
      metadata: integration.metadata
    };
    await record.save();

    logger.info({ userId: req.userId, patientId: patient._id }, 'Patient record integration complete');

    return res.success({ recordId: record._id, integration }, { message: '整合完成' });
  } catch (error) {
    return next(error);
  }
}

async function matchPatientTrials(req, res, next) {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, userId: req.userId });
    if (!patient) {
      throw new NotFoundError('未找到患者');
    }

    const record = await MedicalRecord.findOne({ userId: req.userId, patientId: patient._id }).sort({ uploadDate: -1 });
    if (!record) {
      throw new BadRequestError('尚无病历记录，请先上传或整合');
    }

    const patientData = record.llmIntegrationData?.fullStructuredData || {
      patientProfile: {
        gender: { value: record.structuredData?.gender || null },
        age: { value: record.structuredData?.age || null },
        diagnosis: { primary: record.structuredData?.diagnosis || '' }
      },
      clinicalInformation: {
        ecogScore: record.structuredData?.performanceStatus
          ? { value: record.structuredData.performanceStatus.replace(/[^0-9]/g, '') }
          : null
      },
      treatmentHistory: []
    };

    const trials = await trialCache.loadNormalizedTrials();
    // 修改为排除已完成和暂停的试验，允许unknown状态参与匹配
    const recruitingTrials = trials.filter((trial) => trial.status !== 'completed' && trial.status !== 'suspended');

    const normalizedRecord = normaliseRecordForMatching(record);
    const { trials: candidateTrials, stats: prefilterStats, diseaseSignals } = prefilterTrials(recruitingTrials, normalizedRecord);
    const prefilterMeta = {
      totalCandidates: prefilterStats.totalCandidates,
      afterDisease: prefilterStats.afterDisease,
      afterDemographics: prefilterStats.afterDemographics,
      diseaseApplied: prefilterStats.diseaseApplied,
      demographicsApplied: prefilterStats.demographicsApplied,
      diseaseFallback: Boolean(prefilterStats.diseaseFallback),
      tumorType: diseaseSignals?.tumorType || null,
      diseaseSlug: diseaseSignals?.slug || null,
      diseaseTags: diseaseSignals?.diseaseTags || [],
      rawTerms: diseaseSignals?.rawTerms || [],
      evaluatedTrials: prefilterStats.evaluatedTrials
    };
    const trialLookup = buildTrialLookup(candidateTrials);

    const trialsCsv = trialCache.buildTrialsCsv(candidateTrials);
    const result = await matchService.matchWithLLM({
      patientData,
      csvText: trialsCsv,
      patientId: patient._id.toString()
    });

    if (!result.success) {
      const fallbackMatches = computeClassicMatches(candidateTrials, normalizedRecord, { diseaseSignals });
      const enhancedFallback = attachMetadata(
        mapClassicMatchesToEnhanced(fallbackMatches, trialLookup),
        trialLookup
      );
      const fallbackProvider = {
        ...(result.metadata || {}),
        source: 'structured-json',
        totalTrials: recruitingTrials.length,
        evaluatedTrials: prefilterStats.evaluatedTrials,
        matchedTrials: enhancedFallback.length,
        matchedAt: new Date().toISOString(),
        prefilter: prefilterMeta
      };
      if (record) {
        await saveMatchSnapshot(record, enhancedFallback, fallbackProvider, req.userId);
      }
      logger.warn({ patientId: patient._id }, 'LLM patient matching unavailable, using fallback');
      return res.success({
        matches: enhancedFallback,
        provider: fallbackProvider
      }, { message: 'LLM matching unavailable – falling back to classic matching', status: 206 });
    }

    const normalizedMatches = attachMetadata(result.matches || [], trialLookup);
    const successProvider = {
      ...result.metadata,
      source: 'structured-json',
      totalTrials: recruitingTrials.length,
      evaluatedTrials: prefilterStats.evaluatedTrials,
      matchedTrials: normalizedMatches.length,
      matchedAt: new Date().toISOString(),
      prefilter: prefilterMeta
    };
    if (record) {
      await saveMatchSnapshot(record, normalizedMatches, successProvider, req.userId);
    }
    return res.success({
      matches: normalizedMatches,
      provider: successProvider
    }, { message: 'LLM matching completed' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listPatients,
  createPatient,
  getPatient,
  updatePatient,
  deletePatient,
  listPatientRecords,
  attachMedicalRecord,
  integratePatientRecord,
  matchPatientTrials
};
