const mongoose = require('mongoose');

const matchJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  recordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicalRecord',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed', 'canceled'],
    default: 'running',
    index: true
  },
  batchSize: {
    type: Number,
    default: null
  },
  totalBatches: {
    type: Number,
    default: null
  },
  processedBatches: {
    type: Number,
    default: 0
  },
  processedTrials: {
    type: Number,
    default: 0
  },
  remainingTrials: {
    type: Number,
    default: null
  },
  totalCandidates: {
    type: Number,
    default: null
  },
  sessionId: {
    type: String,
    default: null,
    index: true
  },
  filters: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  filtersHash: {
    type: String,
    default: null,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  error: {
    type: String,
    default: null
  }
}, { timestamps: true });

matchJobSchema.index({ userId: 1, recordId: 1, status: 1 });

module.exports = mongoose.models.MatchJob || mongoose.model('MatchJob', matchJobSchema);
