const request = require('supertest');

const { app } = require('../index');

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
});

