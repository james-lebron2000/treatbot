const request = require('supertest');

const { app } = require('../index');

describe('Health endpoint hardening', () => {
  test('in production, /api/health returns minimal payload by default', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevHealthToken = process.env.HEALTH_TOKEN;
    process.env.NODE_ENV = 'production';
    delete process.env.HEALTH_TOKEN;

    const res = await request(app)
      .get('/api/health')
      .expect(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.data).toHaveProperty('status');
    expect(res.body?.data).toHaveProperty('timestamp');
    expect(res.body?.data).not.toHaveProperty('services');
    expect(res.body?.data).not.toHaveProperty('mode');

    process.env.NODE_ENV = prevNodeEnv;
    if (prevHealthToken === undefined) {
      delete process.env.HEALTH_TOKEN;
    } else {
      process.env.HEALTH_TOKEN = prevHealthToken;
    }
  });

  test('when HEALTH_TOKEN is set, /api/health returns detailed payload with valid bearer token', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevHealthToken = process.env.HEALTH_TOKEN;
    process.env.NODE_ENV = 'production';
    process.env.HEALTH_TOKEN = 'health-secret';

    const res = await request(app)
      .get('/api/health')
      .set('Authorization', 'Bearer health-secret')
      .expect(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.data).toHaveProperty('services');
    expect(res.body?.data?.services).toHaveProperty('mongodb');
    expect(res.body?.data?.services).toHaveProperty('redis');

    process.env.NODE_ENV = prevNodeEnv;
    if (prevHealthToken === undefined) {
      delete process.env.HEALTH_TOKEN;
    } else {
      process.env.HEALTH_TOKEN = prevHealthToken;
    }
  });
});

