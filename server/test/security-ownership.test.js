const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { app } = require('../index');
const { MedicalRecord } = require('../models');
const { defaultContainer } = require('../services/ServiceContainer');

function signToken(userId, role = 'user') {
  return jwt.sign({ userId: String(userId), role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('Security: record ownership enforcement', () => {
  test('POST /api/medical/match returns 404 for record not owned by requester', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();

    const record = await MedicalRecord.create({
      userId: ownerId,
      extractedText: 't',
      structuredData: { primary_diagnosis: '肝细胞癌', age: 55, gender: 'male' }
    });

    const token = signToken(attackerId);
    const res = await request(app)
      .post('/api/medical/match')
      .set('Authorization', `Bearer ${token}`)
      .send({ recordId: record._id.toString() });

    expect(res.status).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  test('POST /api/medical/integrate returns 404 and does not call LLM when record not owned', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const attackerId = new mongoose.Types.ObjectId();

    const record = await MedicalRecord.create({
      userId: ownerId,
      extractedText: 't',
      structuredData: { primary_diagnosis: '肝细胞癌' }
    });

    const integrateMedicalRecord = jest.fn(async () => ({
      success: true,
      correctedText: 'ok',
      structuredData: {},
      clinicalArchive: null,
      timeline: null,
      metadata: {}
    }));
    defaultContainer.deps.llmService = { integrateMedicalRecord };

    const token = signToken(attackerId);
    const res = await request(app)
      .post('/api/medical/integrate')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'some medical text', recordId: record._id.toString() });

    expect(res.status).toBe(404);
    expect(integrateMedicalRecord).not.toHaveBeenCalled();
  });

  test('POST /api/medical/integrate succeeds for owner and calls LLM once', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const record = await MedicalRecord.create({
      userId: ownerId,
      extractedText: 't',
      structuredData: { primary_diagnosis: '肝细胞癌' }
    });

    const integrateMedicalRecord = jest.fn(async () => ({
      success: true,
      correctedText: 'ok',
      structuredData: { patientProfile: { age: { value: 50 } } },
      clinicalArchive: null,
      timeline: null,
      metadata: {}
    }));
    defaultContainer.deps.llmService = { integrateMedicalRecord };

    const token = signToken(ownerId);
    const res = await request(app)
      .post('/api/medical/integrate')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'some medical text', recordId: record._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(integrateMedicalRecord).toHaveBeenCalledTimes(1);
  });
});

