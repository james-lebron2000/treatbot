/*
 * 文件元数据模型
 * 负责管理用户上传文件的完整生命周期
 * 采用文档嵌套设计，避免复杂的关联查询
 */

const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema({
  versionId: {
    type: String,
    required: true,
    unique: true,
    default: () => `v${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  extractedText: {
    type: String,
    default: ''
  },
  ocrMetadata: {
    confidence: Number,
    processingTime: Number,
    language: String,
    pageCount: Number
  },
  structuredData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  fileSize: Number,
  checksum: String
}, {
  _id: false
});

const backupStatusSchema = new mongoose.Schema({
  local: {
    type: Boolean,
    default: true,
    index: true
  },
  cloud: {
    type: Boolean,
    default: false,
    index: true
  },
  lastBackup: {
    type: Date,
    default: null
  },
  backupAttempts: {
    type: Number,
    default: 0
  },
  lastBackupError: String
}, {
  _id: false
});

const fileMetadataSchema = new mongoose.Schema({
  // 基础信息
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
    index: true
  },

  // 文件基本信息
  originalName: {
    type: String,
    required: true,
    trim: true
  },
  fileSize: {
    type: Number,
    required: true,
    min: 0
  },
  mimeType: {
    type: String,
    required: true
  },

  // 存储路径信息
  storagePath: {
    type: String,
    required: true,
    unique: true
  },

  // 数据完整性
  checksum: {
    type: String,
    required: true
  },

  // 版本控制 - 核心设计
  versions: [versionSchema],
  currentVersion: {
    type: Number,
    default: 0
  },

  // 备份状态
  backupStatus: backupStatusSchema,

  // 生命周期管理
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active',
    index: true
  },

  // 访问统计
  accessCount: {
    type: Number,
    default: 0
  },
  lastAccessed: {
    type: Date,
    default: Date.now
  },

  // 元数据扩展
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }],

  // 自动清理配置
  retention: {
    type: String,
    enum: ['1year', '3years', '7years', 'permanent'],
    default: '7years'
  }
}, {
  timestamps: true,
  collection: 'file_metadata'
});

// 复合索引优化
fileMetadataSchema.index({ userId: 1, status: 1, createdAt: -1 });
fileMetadataSchema.index({ patientId: 1, status: 1, createdAt: -1 });
fileMetadataSchema.index({ checksum: 1 });
fileMetadataSchema.index({ 'backupStatus.cloud': 1, 'backupStatus.lastBackup': 1 });

// 实例方法
fileMetadataSchema.methods.getCurrentVersion = function() {
  return this.versions[this.currentVersion] || null;
};

fileMetadataSchema.methods.addVersion = function(versionData) {
  this.versions.push(versionData);
  this.currentVersion = this.versions.length - 1;
  return this.save();
};

fileMetadataSchema.methods.getVersion = function(versionIndex) {
  return this.versions[versionIndex] || null;
};

fileMetadataSchema.methods.compareVersions = function(versionIndex1, versionIndex2) {
  const v1 = this.versions[versionIndex1];
  const v2 = this.versions[versionIndex2];

  if (!v1 || !v2) return null;

  return {
    textDiff: this._computeTextDiff(v1.extractedText, v2.extractedText),
    dataDiff: this._computeDataDiff(v1.structuredData, v2.structuredData),
    metadata: {
      v1: v1.ocrMetadata,
      v2: v2.ocrMetadata
    }
  };
};

fileMetadataSchema.methods._computeTextDiff = function(text1, text2) {
  // 简单的文本差异计算，生产环境可使用更复杂的算法
  const lines1 = text1.split('\n');
  const lines2 = text2.split('\n');

  return {
    added: lines2.filter(line => !lines1.includes(line)),
    removed: lines1.filter(line => !lines2.includes(line)),
    unchanged: lines1.filter(line => lines2.includes(line))
  };
};

fileMetadataSchema.methods._computeDataDiff = function(data1, data2) {
  const keys1 = Object.keys(data1);
  const keys2 = Object.keys(data2);

  return {
    added: keys2.filter(key => !(key in data1)),
    removed: keys1.filter(key => !(key in data2)),
    modified: keys1.filter(key => key in data2 && JSON.stringify(data1[key]) !== JSON.stringify(data2[key])),
    unchanged: keys1.filter(key => key in data2 && JSON.stringify(data1[key]) === JSON.stringify(data2[key]))
  };
};

// 静态方法
fileMetadataSchema.statics.findByUserId = function(userId, options = {}) {
  const { status = 'active', limit = 50, skip = 0 } = options;

  return this.find({ userId, status })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate('patientId', 'name dateOfBirth');
};

fileMetadataSchema.statics.findByChecksum = function(checksum) {
  return this.findOne({ checksum });
};

fileMetadataSchema.statics.getStorageStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId), status: 'active' } },
    {
      $group: {
        _id: null,
        totalFiles: { $sum: 1 },
        totalSize: { $sum: '$fileSize' },
        avgFileSize: { $avg: '$fileSize' },
        cloudBackupCount: {
          $sum: { $cond: ['$backupStatus.cloud', 1, 0] }
        }
      }
    }
  ]);
};

// 预删除钩子 - 软删除
fileMetadataSchema.pre('remove', async function(next) {
  // 实际删除文件和备份
  const FileStorageService = require('../services/storage/FileStorageService');
  await FileStorageService.deleteFile(this.storagePath);
  next();
});

module.exports = mongoose.model('FileMetadata', fileMetadataSchema);
