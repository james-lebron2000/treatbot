const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { app } = require('../index');
const { Patient, MedicalRecord } = require('../models');

function signToken(userId, role = 'user') {
  return jwt.sign({ userId: String(userId), role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createPatientForUser(userId, overrides = {}) {
  return Patient.create({
    userId,
    patientId: `P${Math.random().toString(36).slice(2, 6)}`,
    name: 'Ownership Test Patient',
    gender: 'male',
    ...overrides,
  });
}

async function createRecordForUser(userId, overrides = {}) {
  return MedicalRecord.create({
    userId,
    extractedText: 'Ownership test medical text',
    structuredData: { diagnosis: 'test' },
    ...overrides,
  });
}

describe('Security: patient and medical route ownership', () => {
  test('GET /api/patients/:id returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const patient = await createPatientForUser(ownerId);

    const res = await request(app)
      .get(`/api/patients/${patient._id}`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('PUT /api/patients/:id returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const patient = await createPatientForUser(ownerId);

    const res = await request(app)
      .put(`/api/patients/${patient._id}`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('GET /api/patients/:id/records returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const patient = await createPatientForUser(ownerId);
    await createRecordForUser(ownerId, { patientId: patient._id });

    const res = await request(app)
      .get(`/api/patients/${patient._id}/records`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('GET /api/medical/records/:id returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const record = await createRecordForUser(ownerId);

    const res = await request(app)
      .get(`/api/medical/records/${record._id}`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('PUT /api/medical/records/:id returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const record = await createRecordForUser(ownerId);

    const res = await request(app)
      .put(`/api/medical/records/${record._id}`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`)
      .send({ extractedText: 'attacker update' });

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('DELETE /api/medical/records/:id returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const record = await createRecordForUser(ownerId);

    const res = await request(app)
      .delete(`/api/medical/records/${record._id}`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
    const stillExists = await MedicalRecord.findById(record._id);
    expect(stillExists).toBeTruthy();
  });

  test('GET /api/medical/records/:id/report returns 404 for non-owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();
    const record = await createRecordForUser(ownerId);

    const res = await request(app)
      .get(`/api/medical/records/${record._id}/report`)
      .set('Authorization', `Bearer ${signToken(attackerId)}`);

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('GET /api/medical/records/:id succeeds for owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const record = await createRecordForUser(ownerId);

    const res = await request(app)
      .get(`/api/medical/records/${record._id}`)
      .set('Authorization', `Bearer ${signToken(ownerId)}`);

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.record?._id || res.body?.data?.record?.id).toBeDefined();
  });
});

