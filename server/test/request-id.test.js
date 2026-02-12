const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { app } = require('../index');
const logger = require('../utils/logger');
const { defaultContainer } = require('../services/ServiceContainer');

function signToken(userId, role = 'user') {
  return jwt.sign({ userId: String(userId), role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('Request Id propagation', () => {
  test('echoes X-Request-Id and traceId when provided by client', async () => {
    const rid = 'test-request-id-123';
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-Id', rid)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(rid);
    expect(res.body).toHaveProperty('traceId', rid);
  });

  test('generates X-Request-Id when not provided', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(200);

    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('traceId', res.headers['x-request-id']);
  });

  test('keeps traceId consistent across failed response and critical error logs', async () => {
    const rid = 'trace-fail-chain-001';
    const userId = new mongoose.Types.ObjectId();
    const token = signToken(userId);
    const stepwiseService = defaultContainer.deps.stepwiseLLMService;
    const loggerSpy = jest.spyOn(logger, 'error');

    jest.spyOn(stepwiseService, 'getExtractionStatus').mockRejectedValue(new Error('forced failure'));

    const res = await request(app)
      .get('/api/medical/extract/status/job_failure_case')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', rid)
      .expect(500);

    expect(res.headers['x-request-id']).toBe(rid);
    expect(res.body).toHaveProperty('traceId', rid);

    const callsWithTraceId = loggerSpy.mock.calls.filter((call) => {
      const payload = call[0];
      return Boolean(payload && typeof payload === 'object' && payload.traceId === rid);
    });

    // One from stepwise controller catch, one from global error handler.
    expect(callsWithTraceId.length).toBeGreaterThanOrEqual(2);
  });
});
