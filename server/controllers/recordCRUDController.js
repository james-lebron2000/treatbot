const mongoose = require('mongoose');
const { z } = require('zod');

const { MedicalRecord, Patient } = require('../models');
const cacheService = require('../services/cache');
const { BadRequestError, NotFoundError } = require('../utils/httpError');
const { refreshPatientLatestData } = require('../utils/medicalHelpers');
const { recordMatchBatchMetrics } = require('../monitoring/metrics');

const { recordUpdateSchema } = require('./medicalSchemas');

async function listMedicalRecords(req, res, next) {
  try {
    const records = await MedicalRecord.find({ userId: req.userId }).sort({ uploadDate: -1 });
    return res.success({ records }, { message: 'Records retrieved' });
  } catch (error) {
    recordMatchBatchMetrics({ durationMs: 0, batchSize: 0, status: 'error' });
    return next(error);
  }
}

async function getMedicalRecord(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: id, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    return res.success({ record }, { message: 'Record retrieved' });
  } catch (error) {
    recordMatchBatchMetrics({ durationMs: 0, batchSize: 0, status: 'error' });
    return next(error);
  }
}

async function updateMedicalRecord(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const updates = recordUpdateSchema.parse(req.body || {});

    const record = await MedicalRecord.findOne({ _id: id, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const previousPatientId = record.patientId ? record.patientId.toString() : null;

    if (Object.prototype.hasOwnProperty.call(updates, 'patientId')) {
      if (updates.patientId === null) {
        record.patientId = undefined;
      } else {
        const patient = await Patient.findOne({ _id: updates.patientId, userId: req.userId });
        if (!patient) {
          throw new NotFoundError('Patient not found');
        }
        record.patientId = patient._id;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'extractedText')) {
      record.extractedText = updates.extractedText;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'structuredData')) {
      record.structuredData = {
        ...(record.structuredData ? JSON.parse(JSON.stringify(record.structuredData)) : {}),
        ...(updates.structuredData || {})
      };
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'llmIntegrationData')) {
      record.llmIntegrationData = {
        ...(record.llmIntegrationData ? JSON.parse(JSON.stringify(record.llmIntegrationData)) : {}),
        ...(updates.llmIntegrationData || {})
      };
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'ocrMetadata')) {
      record.ocrMetadata = {
        ...(record.ocrMetadata ? record.ocrMetadata.toObject?.() || record.ocrMetadata : {}),
        ...updates.ocrMetadata
      };
    }

    await record.save();

    const newPatientId = record.patientId ? record.patientId.toString() : null;

    if (newPatientId) {
      await refreshPatientLatestData(record.patientId, req.userId);
    }

    if (previousPatientId && previousPatientId !== newPatientId) {
      await refreshPatientLatestData(previousPatientId, req.userId);
    }

    await cacheService.flushByPrefix(`match:classic:${id}`);
    await cacheService.flushByPrefix(`match:llm:${id}`);

    return res.success({ record }, { message: 'Record updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new BadRequestError('Invalid input', { details: error.issues }));
    }
    return next(error);
  }
}

async function deleteMedicalRecord(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestError('Invalid medical record identifier');
    }

    const record = await MedicalRecord.findOne({ _id: id, userId: req.userId });
    if (!record) {
      throw new NotFoundError('Medical record not found');
    }

    const patientId = record.patientId ? record.patientId.toString() : null;

    await record.deleteOne();

    if (patientId) {
      await refreshPatientLatestData(patientId, req.userId);
    }

    await cacheService.flushByPrefix(`match:classic:${id}`);
    await cacheService.flushByPrefix(`match:llm:${id}`);

    return res.success({ recordId: id }, { message: 'Record deleted' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listMedicalRecords,
  getMedicalRecord,
  updateMedicalRecord,
  deleteMedicalRecord
};
