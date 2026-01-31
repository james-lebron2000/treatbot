/**
 * 文件存储服务
 * 统一处理本地存储、云备份、版本控制
 * 采用策略模式，支持多种存储后端
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');

class FileStorageService {
  constructor() {
    this.storageBasePath = process.env.STORAGE_BASE_PATH || './uploads';
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024; // 50MB
    this.cloudBackupEnabled = String(process.env.CLOUD_BACKUP_ENABLED || '').toLowerCase() === 'true';
    this.allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'text/plain'
    ];

    this._ensureStorageDirectory();
  }

  /**
   * 存储文件
   * 采用三层存储策略：本地立即存储 + 异步云备份 + 版本控制
   */
  async storeFile(file, metadata) {
    try {
      // 验证文件
      this._validateFile(file);

      // 生成文件路径
      const filePath = await this._generateFilePath(metadata);
      const fullPath = path.join(this.storageBasePath, filePath);

      // 计算文件哈希
      const checksum = await this._calculateChecksum(file.path);

      // 检查重复文件
      const existingFile = await this._checkDuplicate(checksum);
      if (existingFile) {
        logger.info('Duplicate file detected, reusing existing file', {
          checksum,
          originalPath: existingFile.storagePath
        });
        return existingFile;
      }

      // 移动文件到目标位置
      await this._moveFile(file.path, fullPath);

      // 生成存储元数据
      const storageMetadata = {
        originalName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storagePath: filePath,
        checksum,
        createdAt: new Date()
      };

      // 异步触发云备份
      this._triggerCloudBackup(fullPath, storageMetadata).catch(error => {
        logger.error('Cloud backup failed', { error, filePath });
      });

      return storageMetadata;
    } catch (error) {
      logger.error('File storage failed', { error, metadata });
      throw new AppError('文件存储失败', 500);
    }
  }

  /**
   * 读取文件
   * 支持本地和云端恢复
   */
  async readFile(storagePath, options = {}) {
    const { preferCloud = false, forceCloud = false } = options;
    const fullPath = path.join(this.storageBasePath, storagePath);

    try {
      if (forceCloud || (preferCloud && !(await this._fileExists(fullPath)))) {
        // 从云端恢复
        return await this._restoreFromCloud(storagePath);
      }

      // 本地读取
      return await fs.readFile(fullPath);
    } catch (error) {
      logger.error('File read failed', { error, storagePath });
      throw new AppError('文件读取失败', 404);
    }
  }

  /**
   * 创建文件版本
   * 采用差异存储策略，节省存储空间
   */
  async createVersion(storagePath, versionData) {
    try {
      const versionId = `v${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const versionPath = `${storagePath}.versions/${versionId}`;

      // 存储版本信息
      const versionInfo = {
        versionId,
        createdAt: new Date(),
        ...versionData
      };

      // 如果是文本内容，计算差异并存储
      if (versionData.extractedText) {
        versionInfo.textDiff = await this._computeTextDiff(storagePath, versionData.extractedText);
      }

      await this._storeVersionMetadata(versionPath, versionInfo);
      return versionInfo;
    } catch (error) {
      logger.error('Version creation failed', { error, storagePath });
      throw new AppError('版本创建失败', 500);
    }
  }

  /**
   * 删除文件
   * 软删除策略，保留一定时间的备份
   */
  async deleteFile(storagePath, options = {}) {
    const { permanent = false, keepBackup = true } = options;

    try {
      const fullPath = path.join(this.storageBasePath, storagePath);

      if (permanent) {
        // 永久删除
        await this._permanentDelete(fullPath, keepBackup);
      } else {
        // 软删除 - 移动到回收站
        await this._softDelete(fullPath);
      }
    } catch (error) {
      logger.error('File deletion failed', { error, storagePath });
      throw new AppError('文件删除失败', 500);
    }
  }

  /**
   * 获取存储统计
   */
  async getStorageStats() {
    try {
      const stats = await this._calculateStorageStats();
      return {
        totalSize: stats.totalSize,
        fileCount: stats.fileCount,
        averageSize: stats.fileCount > 0 ? stats.totalSize / stats.fileCount : 0,
        cloudBackupSize: stats.cloudBackupSize,
        localStorageSize: stats.totalSize - stats.cloudBackupSize
      };
    } catch (error) {
      logger.error('Storage stats calculation failed', { error });
      throw new AppError('存储统计失败', 500);
    }
  }

  // 私有方法

  async _ensureStorageDirectory() {
    try {
      await fs.mkdir(this.storageBasePath, { recursive: true });
      await fs.mkdir(path.join(this.storageBasePath, '.trash'), { recursive: true });
      await fs.mkdir(path.join(this.storageBasePath, '.versions'), { recursive: true });
    } catch (error) {
      logger.error('Storage directory creation failed', { error });
      throw new AppError('存储目录创建失败', 500);
    }
  }

  _validateFile(file) {
    if (file.size > this.maxFileSize) {
      throw new AppError(`文件大小超过限制 (${this.maxFileSize / (1024 * 1024)}MB)`, 413);
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new AppError(`不支持的文件类型: ${file.mimetype}`, 415);
    }
  }

  async _generateFilePath(metadata) {
    const { userId, patientId, originalName } = metadata;
    const timestamp = Date.now();
    const safeFileName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const extension = path.extname(safeFileName);
    const baseName = path.basename(safeFileName, extension);

    return `${userId}/${patientId}/${timestamp}_${baseName}${extension}`;
  }

  async _calculateChecksum(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async _checkDuplicate(checksum) {
    const FileMetadata = require('../../models/FileMetadata');
    return await FileMetadata.findOne({ checksum });
  }

  async _moveFile(sourcePath, targetPath) {
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.rename(sourcePath, targetPath);
  }

  async _triggerCloudBackup(filePath, metadata) {
    if (!this.cloudBackupEnabled) {
      return { skipped: true, reason: 'CLOUD_BACKUP_ENABLED=false' };
    }
    const CloudStorageService = require('./CloudStorageService');
    return await CloudStorageService.backupFile(filePath, metadata);
  }

  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async _restoreFromCloud(storagePath) {
    const CloudStorageService = require('./CloudStorageService');
    return await CloudStorageService.restoreFile(storagePath);
  }

  async _computeTextDiff(storagePath, newText) {
    try {
      const fullPath = path.join(this.storageBasePath, storagePath);
      const oldContent = await fs.readFile(fullPath, 'utf8');

      // 简单的行级差异算法
      const oldLines = oldContent.split('\n');
      const newLines = newText.split('\n');

      return {
        added: newLines.filter(line => !oldLines.includes(line)),
        removed: oldLines.filter(line => !newLines.includes(line)),
        unchanged: oldLines.filter(line => newLines.includes(line))
      };
    } catch (error) {
      logger.warn('Text diff computation failed', { error, storagePath });
      return null;
    }
  }

  async _storeVersionMetadata(versionPath, versionInfo) {
    const versionDir = path.dirname(path.join(this.storageBasePath, versionPath));
    await fs.mkdir(versionDir, { recursive: true });

    const metadataPath = `${versionPath}.json`;
    await fs.writeFile(
      path.join(this.storageBasePath, metadataPath),
      JSON.stringify(versionInfo, null, 2)
    );
  }

  async _permanentDelete(filePath, keepBackup) {
    if (await this._fileExists(filePath)) {
      await fs.unlink(filePath);
    }

    if (!keepBackup) {
      // 删除云备份
      if (!this.cloudBackupEnabled) {
        return;
      }
      const CloudStorageService = require('./CloudStorageService');
      await CloudStorageService.deleteBackup(filePath);
    }
  }

  async _softDelete(filePath) {
    if (await this._fileExists(filePath)) {
      const trashPath = filePath.replace(this.storageBasePath, path.join(this.storageBasePath, '.trash'));
      await this._moveFile(filePath, trashPath);
    }
  }

  async _calculateStorageStats() {
    const stats = {
      totalSize: 0,
      fileCount: 0,
      cloudBackupSize: 0
    };

    // 递归计算本地文件大小
    await this._calculateDirectoryStats(this.storageBasePath, stats);

    return stats;
  }

  async _calculateDirectoryStats(dirPath, stats) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await this._calculateDirectoryStats(fullPath, stats);
        } else if (entry.isFile()) {
          const fileStats = await fs.stat(fullPath);
          stats.totalSize += fileStats.size;
          stats.fileCount++;
        }
      }
    } catch (error) {
      logger.warn('Directory stats calculation failed', { error, dirPath });
    }
  }
}

module.exports = new FileStorageService();
