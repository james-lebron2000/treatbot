const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { app } = require('../index');
const { Patient, MedicalRecord } = require('../models');
const { defaultContainer } = require('../services/ServiceContainer');
const { createPatientArchive } = require('../utils/patientArchive');

function signToken(userId, role = 'user') {
  return jwt.sign({ userId: String(userId), role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createPatientForUser(userId, overrides = {}) {
  return Patient.create({
    userId,
    patientId: `P${Math.random().toString(36).slice(2, 6)}`,
    name: 'Stepwise Ownership Test Patient',
    gender: 'male',
    ...overrides,
  });
}

async function createRecordForUser(userId, overrides = {}) {
  return MedicalRecord.create({
    userId,
    extractedText: 'Stepwise ownership test medical text',
    structuredData: { diagnosis: 'test' },
    ...overrides,
  });
}

describe('Security: stepwise job ownership enforcement', () => {
  const stepwiseService = defaultContainer.deps.stepwiseLLMService;
  const jobStore = new Map();

  beforeEach(() => {
    jobStore.clear();
    jest.spyOn(stepwiseService, 'loadJob').mockImplementation(async (jobId) => {
      return jobStore.get(String(jobId)) || null;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seedJob({
    jobId,
    userId,
    status = 'running',
  }) {
    const now = new Date();
    jobStore.set(jobId, {
      jobId,
      userId: String(userId),
      patientId: '',
      medicalText: 'mock medical text',
      startTime: now,
      endTime: status.startsWith('completed') ? now : null,
      processingTime: status.startsWith('completed') ? 300 : null,
      status,
      currentStep: status.startsWith('completed') ? 11 : 1,
      totalSteps: 11,
      results: {},
      errors: [],
      metadata: { provider: 'test', model: 'test-model' },
      clinicalArchive: createPatientArchive(''),
      recordId: null
    });
  }

  test('GET /api/medical/extract/status/:jobId returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const jobId = 'job_owner_only_status';
    seedJob({ jobId, userId: ownerId, status: 'running' });

    const token = signToken(attackerId);
    const res = await request(app)
      .get(`/api/medical/extract/status/${jobId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('GET /api/medical/extract/status/:jobId succeeds for owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const jobId = 'job_owner_status_ok';
    seedJob({ jobId, userId: ownerId, status: 'running' });

    const token = signToken(ownerId);
    const res = await request(app)
      .get(`/api/medical/extract/status/${jobId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.jobId).toBe(jobId);
  });

  test('GET /api/medical/extract/result/:jobId returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const jobId = 'job_owner_only_result';
    seedJob({ jobId, userId: ownerId, status: 'completed' });

    const token = signToken(attackerId);
    const res = await request(app)
      .get(`/api/medical/extract/result/${jobId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('GET /api/medical/extract/result/:jobId succeeds for owner when completed', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const jobId = 'job_owner_result_ok';
    seedJob({ jobId, userId: ownerId, status: 'completed' });

    const token = signToken(ownerId);
    const res = await request(app)
      .get(`/api/medical/extract/result/${jobId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.extractionJobId).toBe(jobId);
  });

  test('POST /api/medical/extract/stepwise returns 404 for non-owner patientId', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const patient = await createPatientForUser(ownerId);
    const startSpy = jest.spyOn(stepwiseService, 'startStepwiseExtraction').mockResolvedValue({
      jobId: 'job_non_owner_patient',
      status: 'running',
      totalSteps: 11
    });

    const token = signToken(attackerId);
    const res = await request(app)
      .post('/api/medical/extract/stepwise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: 'test medical text',
        patientId: String(patient._id)
      });

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('POST /api/medical/extract/stepwise returns 404 for non-owner recordId', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const patient = await createPatientForUser(ownerId);
    const record = await createRecordForUser(ownerId, { patientId: patient._id });
    const startSpy = jest.spyOn(stepwiseService, 'startStepwiseExtraction').mockResolvedValue({
      jobId: 'job_non_owner_record',
      status: 'running',
      totalSteps: 11
    });

    const token = signToken(attackerId);
    const res = await request(app)
      .post('/api/medical/extract/stepwise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: 'test medical text',
        recordId: String(record._id)
      });

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
  });

  test('POST /api/medical/extract/stepwise succeeds for owner patientId', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const patient = await createPatientForUser(ownerId);
    const startSpy = jest.spyOn(stepwiseService, 'startStepwiseExtraction').mockResolvedValue({
      jobId: 'job_owner_start_ok',
      status: 'running',
      totalSteps: 11
    });

    const token = signToken(ownerId);
    const res = await request(app)
      .post('/api/medical/extract/stepwise')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: 'test medical text',
        patientId: String(patient._id)
      });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.jobId).toBe('job_owner_start_ok');
    expect(startSpy).toHaveBeenCalledWith(
      'test medical text',
      String(patient._id),
      expect.objectContaining({
        userId: String(ownerId),
        recordId: null
      })
    );
  });
});
