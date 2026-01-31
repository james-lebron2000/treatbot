/**
 * 文件存储迁移脚本
 * 将现有文件迁移到新的持久化存储系统
 * 添加版本控制和云备份支持
 */

const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const logger = require('../utils/logger');
const FileMetadata = require('../models/FileMetadata');
const Patient = require('../models/Patient');
const User = require('../models/User');

class FileStorageMigration {
  constructor() {
    this.uploadsDir = path.join(__dirname, '../uploads');
    this.batchSize = 100;
    this.migrationStats = {
      totalFiles: 0,
      migratedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      totalSize: 0
    };
  }

  async run() {
    try {
      logger.info('Starting file storage migration');

      // 连接数据库
      await this.connectDatabase();

      // 扫描现有文件
      const existingFiles = await this.scanExistingFiles();
      this.migrationStats.totalFiles = existingFiles.length;

      logger.info(`Found ${existingFiles.length} files to migrate`);

      // 分批迁移文件
      for (let i = 0; i < existingFiles.length; i += this.batchSize) {
        const batch = existingFiles.slice(i, i + this.batchSize);
        await this.migrateBatch(batch);

        logger.info(`Migrated batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(existingFiles.length / this.batchSize)}`);
      }

      // 生成迁移报告
      await this.generateMigrationReport();

      logger.info('File storage migration completed', {
        stats: this.migrationStats
      });

    } catch (error) {
      logger.error('File storage migration failed', { error });
      throw error;
    } finally {
      await mongoose.disconnect();
    }
  }

  async connectDatabase() {
    try {
      await mongoose.connect(config.mongoUri);
      logger.info('Connected to MongoDB');
    } catch (error) {
      logger.error('Failed to connect to MongoDB', { error });
      throw error;
    }
  }

  async scanExistingFiles() {
    try {
      const files = [];
      await this.scanDirectory(this.uploadsDir, files);
      return files;
    } catch (error) {
      logger.error('Failed to scan existing files', { error });
      throw error;
    }
  }

  async scanDirectory(dir, files, basePath = '') {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, files, relativePath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          files.push({
            path: fullPath,
            relativePath: relativePath,
            size: stat.size,
            modified: stat.mtime
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to scan directory ${dir}`, { error });
    }
  }

  async migrateBatch(files) {
    for (const file of files) {
      try {
        await this.migrateSingleFile(file);
        this.migrationStats.migratedFiles++;
      } catch (error) {
        logger.error(`Failed to migrate file ${file.relativePath}`, { error });
        this.migrationStats.failedFiles++;
      }
    }
  }

  async migrateSingleFile(file) {
    try {
      // 计算文件哈希
      const checksum = await this.calculateFileChecksum(file.path);

      // 检查是否已存在
      const existingFile = await FileMetadata.findOne({ checksum });
      if (existingFile) {
        logger.info(`File already exists: ${file.relativePath}`);
        this.migrationStats.skippedFiles++;
        return;
      }

      // 解析文件信息
      const fileInfo = this.parseFileInfo(file.relativePath);
      if (!fileInfo) {
        logger.warn(`Cannot parse file info: ${file.relativePath}`);
        this.migrationStats.skippedFiles++;
        return;
      }

      // 查找对应的用户和患者
      const { userId, patientId } = await this.findRelatedEntities(fileInfo);
      if (!userId || !patientId) {
        logger.warn(`Cannot find related entities for: ${file.relativePath}`);
        this.migrationStats.skippedFiles++;
        return;
      }

      // 创建文件元数据
      const fileMetadata = new FileMetadata({
        userId,
        patientId,
        originalName: fileInfo.originalName,
        fileSize: file.size,
        mimeType: this.getMimeType(fileInfo.extension),
        storagePath: file.relativePath,
        checksum,
        versions: [{
          versionId: `v${Date.now()}-migration`,
          createdAt: file.modified,
          extractedText: '',
          ocrMetadata: {},
          structuredData: {},
          fileSize: file.size,
          checksum
        }],
        currentVersion: 0,
        backupStatus: {
          local: true,
          cloud: false,
          lastBackup: null
        },
        status: 'active',
        accessCount: 0,
        lastAccessed: new Date(),
        tags: this.generateTags(fileInfo),
        retention: '7years'
      });

      await fileMetadata.save();

      this.migrationStats.totalSize += file.size;
      logger.info(`Migrated file: ${file.relativePath}`);

    } catch (error) {
      logger.error(`Failed to migrate single file: ${file.relativePath}`, { error });
      throw error;
    }
  }

  parseFileInfo(relativePath) {
    try {
      const parts = relativePath.split(path.sep);
      if (parts.length < 3) {
        return null;
      }

      const fileName = parts[parts.length - 1];
      const extension = path.extname(fileName);
      const baseName = path.basename(fileName, extension);

      return {
        userId: parts[0],
        patientId: parts[1],
        originalName: fileName,
        extension: extension.toLowerCase()
      };
    } catch (error) {
      logger.error(`Failed to parse file info: ${relativePath}`, { error });
      return null;
    }
  }

  async findRelatedEntities(fileInfo) {
    try {
      // 查找用户
      const user = await User.findById(fileInfo.userId);
      if (!user) {
        logger.warn(`User not found: ${fileInfo.userId}`);
        return { userId: null, patientId: null };
      }

      // 查找患者
      const patient = await Patient.findOne({
        _id: fileInfo.patientId,
        userId: fileInfo.userId
      });

      if (!patient) {
        logger.warn(`Patient not found: ${fileInfo.patientId} for user ${fileInfo.userId}`);
        return { userId: null, patientId: null };
      }

      return {
        userId: user._id,
        patientId: patient._id
      };
    } catch (error) {
      logger.error('Failed to find related entities', { error, fileInfo });
      return { userId: null, patientId: null };
    }
  }

  getMimeType(extension) {
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.tiff': 'image/tiff',
      '.txt': 'text/plain'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  generateTags(fileInfo) {
    const tags = [];

    // 基于文件扩展名
    if (fileInfo.extension === '.pdf') {
      tags.push('pdf', 'document');
    } else if (['.jpg', '.jpeg', '.png', '.tiff'].includes(fileInfo.extension)) {
      tags.push('image', 'medical-image');
    }

    // 基于文件名
    const fileNameLower = fileInfo.originalName.toLowerCase();
    if (fileNameLower.includes('report')) tags.push('report');
    if (fileNameLower.includes('lab')) tags.push('lab-result');
    if (fileNameLower.includes('scan')) tags.push('scan');
    if (fileNameLower.includes('xray')) tags.push('x-ray');

    return tags;
  }

  async calculateFileChecksum(filePath) {
    try {
      const hash = crypto.createHash('sha256');
      const stream = require('fs').createReadStream(filePath);

      return new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error(`Failed to calculate checksum for ${filePath}`, { error });
      throw error;
    }
  }

  async generateMigrationReport() {
    const report = {
      timestamp: new Date().toISOString(),
      stats: this.migrationStats,
      summary: {
        successRate: ((this.migrationStats.migratedFiles / this.migrationStats.totalFiles) * 100).toFixed(2),
        averageFileSize: this.migrationStats.totalSize / this.migrationStats.migratedFiles,
        totalStorageSaved: this.migrationStats.skippedFiles * (this.migrationStats.totalSize / this.migrationStats.totalFiles)
      }
    };

    const reportPath = path.join(__dirname, `migration-report-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    logger.info(`Migration report saved to: ${reportPath}`);
  }
}

// 运行迁移
if (require.main === module) {
  const migration = new FileStorageMigration();
  migration.run().catch(error => {
    logger.error('Migration failed', { error });
    process.exit(1);
  });
}

module.exports = FileStorageMigration;