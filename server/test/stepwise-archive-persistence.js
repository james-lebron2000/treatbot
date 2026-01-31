process.env.APP_MODE = 'mock';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://example.com/mock';

const StepwiseLLMService = require('../services/stepwiseLLMService');
const { MedicalRecord, Patient } = require('../models');

const mockRecord = {
  _id: 'mock-record-1',
  userId: 'mock-user-1',
  patientId: 'mock-patient-1',
  clinicalArchive: null,
  structuredData: {},
  llmIntegrationData: null,
  markModified(field) {
    this._lastModified = field;
  },
  async save() {
    this._saved = true;
    return this;
  }
};

const patientUpdates = [];

MedicalRecord.findById = async (id) => {
  if (id === mockRecord._id || id === String(mockRecord._id)) {
    return mockRecord;
  }
  return null;
};

Patient.findByIdAndUpdate = async (id, update) => {
  patientUpdates.push({ id, update });
  return { acknowledged: true };
};

const service = new StepwiseLLMService();

const makeResult = (data) => ({
  success: true,
  data,
  confidence: 'high',
  reasoning: 'mock-data'
});

service.extractBasicInfo = async () => makeResult({
  age: 62,
  gender: 'male',
  ethnicity: '汉族',
  height_cm: 175,
  weight_kg: 70
});

service.extractDiagnosisStaging = async () => makeResult({
  primary_diagnosis: '肝细胞癌',
  pathology_type: '中分化',
  grade: 'III级',
  staging_system: 'CNLC',
  staging_value: 'IIIb'
});

service.extractMetastasisLesions = async () => makeResult({
  metastasis_sites: ['肺'],
  measurable_lesions: true
});

service.extractPerformanceStatus = async () => makeResult({
  ecog_score: 1,
  expected_survival_months: 12
});

service.extractSurgicalHistory = async () => makeResult({
  surgical_history: [
    {
      procedure: '肝右叶切除术',
      date: '2016-04-26',
      pathology_stage: 'pT2',
      response: 'CR'
    }
  ]
});

service.extractSystemicTreatments = async () => makeResult({
  systemic_treatments: [
    {
      line: 1,
      regimen: ['索拉非尼'],
      drug_classes: ['靶向治疗'],
      start_date: '2018-01-01',
      best_response: 'SD'
    }
  ]
});

service.extractLabValues = async () => makeResult({
  lab_date: '2025-05-01',
  blood_counts: { wbc: 4.8, anc: 2.4, platelet: 140, hemoglobin: 125 },
  liver_function: { alt: 25, ast: 30, tbil: 18, alb: 42 },
  kidney_function: { creatinine: 70, bun: 5.6 },
  tumor_markers: [
    { marker: 'AFP', value: 350, unit: 'ng/mL', trend: '升高' }
  ]
});

service.extractComorbidities = async () => makeResult({
  viral_hepatitis: { hbv_status: '阳性', antiviral_treatment: true }
});

service.extractMolecularMarkers = async () => makeResult({
  genetic_mutations: [{ gene: 'TP53', status: '突变' }],
  msi_status: 'MSS'
});

service.extractAdverseEvents = async () => makeResult({
  severe_adverse_events: [{ event: '手足综合征', ctcae_grade: 2 }]
});

service.extractSpecialConditions = async () => makeResult({
  special_conditions: { cns_metastasis_controlled: false }
});

(async () => {
  await service.startStepwiseExtraction('示例病历文本', mockRecord.patientId, {
    recordId: mockRecord._id,
    userId: 'mock-user-1',
    seedArchive: null
  });

  console.log('Clinical archive persisted:', !!mockRecord.clinicalArchive);
  console.log('Structured data keys:', Object.keys(mockRecord.structuredData || {}));
  console.log('Last modified field:', mockRecord._lastModified);
  console.log('Patient updates:', patientUpdates);
})();
