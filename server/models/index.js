const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  // Phone-based login (OTP). Optional for backward compatibility.
  phone: {
    type: String,
    required: false,
    unique: true,
    sparse: true
  },
  phoneVerifiedAt: {
    type: Date,
    default: null
  },
  // Stored for phone OTP login flow
  otp: {
    hash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    failedAttempts: { type: Number, default: 0 },
    lastRequestedAt: { type: Date, default: null }
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  consents: {
    complianceSecurityAgreement: {
      accepted: { type: Boolean, default: false },
      version: { type: String, default: null },
      acceptedAt: { type: Date, default: null },
      ip: { type: String, default: null },
      userAgent: { type: String, default: null }
    }
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const matchHistoryEntrySchema = new mongoose.Schema({
  matches: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true, timestamps: false });

const medicalRecordSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // 可选：关联到患者
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: false
  },
  originalFileName: String,
  extractedText: String,
  structuredData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // LLM 整合后的完整数据与元信息
  llmIntegrationData: {
    correctedText: String,
    fullStructuredData: Object,
    timeline: String,
    metadata: Object
  },
  clinicalArchive: {
    type: Object,
    default: null
  },
  // 多文件支持
  multipleFiles: {
    fileCount: Number,
    fileDetails: [{
      fileName: String,
      fileId: String,
      confidence: Number,
      pageCount: Number
    }]
  },
  matchResults: {
    type: [Object],
    default: []
  },
  matchMetadata: {
    type: Object,
    default: null
  },
  matchHistory: {
    type: [matchHistoryEntrySchema],
    default: []
  },
  // OCR 元数据
  ocrMetadata: {
    provider: {
      type: String,
      default: 'aliyun'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100
    },
    processingTime: {
      type: Number,  // 处理时间(毫秒)
    },
    apiRequestId: String,  // API 请求ID
    templateType: {
      type: String,
      enum: ['general', 'medical', 'mixed'],
      default: 'general'
    },
    pageCount: {
      type: Number,
      default: 1
    },
    processedAt: Date,
    totalCost: Number,  // 估算成本
    errorMessage: String,
    isMultipleFiles: {
      type: Boolean,
      default: false
    },
    isFallback: {
      type: Boolean,
      default: false
    },
    pages: [{  // 分页详情
      page: Number,
      confidence: Number,
      content: String
    }]
  },
  uploadDate: {
    type: Date,
    default: Date.now
  }
});

// Query hot paths:
// - list records for a user sorted by uploadDate
// - fetch latest record for a user+patient sorted by uploadDate
medicalRecordSchema.index({ userId: 1, uploadDate: -1 });
medicalRecordSchema.index({ userId: 1, patientId: 1, uploadDate: -1 });

const clinicalTrialSchema = new mongoose.Schema({
  trialId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  location: String,
  phase: String,
  condition: String,
  sponsor: String,
  inclusionCriteria: [String],
  exclusionCriteria: [String],
  targetMutations: [String],
  ageRange: {
    min: Number,
    max: Number
  },
  gender: String,
  status: {
    type: String,
    enum: ['recruiting', 'active', 'completed', 'suspended'],
    default: 'recruiting'
  },
  estimatedEnrollment: Number,
  contactInfo: {
    name: String,
    phone: String,
    email: String
  },
  structuredEligibility: {
    inclusion: [
      {
        criterionId: String,
        label: String,
        category: String,
        criterion: String,
        requirement: mongoose.Schema.Types.Mixed,
        notes: String
      }
    ],
    exclusion: [
      {
        criterionId: String,
        label: String,
        category: String,
        criterion: String,
        requirement: mongoose.Schema.Types.Mixed,
        notes: String
      }
    ]
  },
  eligibilityLastSyncedAt: Date
});

// 患者模型
const patientSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientId: { type: String, required: true },
  name: { type: String, required: true },
  gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
  contactInfo: {
    email: { type: String },
    phone: { type: String },
    address: { type: String }
  },
  dob: { type: Date },
  notes: { type: String },
  tags: [String],
  latestRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord' },
  latestStructuredData: { type: Object },
  latestClinicalArchive: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

patientSchema.index({ userId: 1, patientId: 1 }, { unique: true });
patientSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

const MatchJob = require('./MatchJob');

module.exports = {
  User: mongoose.model('User', userSchema),
  MedicalRecord: mongoose.model('MedicalRecord', medicalRecordSchema),
  ClinicalTrial: mongoose.model('ClinicalTrial', clinicalTrialSchema),
  Patient: mongoose.model('Patient', patientSchema),
  MatchJob
};
