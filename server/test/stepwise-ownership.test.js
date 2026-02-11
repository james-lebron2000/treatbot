const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { app } = require('../index');
const { defaultContainer } = require('../services/ServiceContainer');
const { createPatientArchive } = require('../utils/patientArchive');

function signToken(userId, role = 'user') {
  return jwt.sign({ userId: String(userId), role }, process.env.JWT_SECRET, { expiresIn: '1h' });
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
});

