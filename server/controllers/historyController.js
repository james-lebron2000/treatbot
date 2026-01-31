/**
 * 历史记录控制器
 * 处理用户数据持久化和回看功能
 * 支持版本对比、数据导出、时间线展示
 */

const FileMetadata = require('../models/FileMetadata');
const { Patient } = require('../models');
const FileStorageService = require('../services/storage/FileStorageService');
const CloudStorageService = require('../services/storage/CloudStorageService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

class HistoryController {
  /**
   * 获取用户历史记录列表
   * 支持分页、筛选、排序
   */
  async getUserHistory(req, res, next) {
    try {
      const userId = req.userId;
      const {
        page = 1,
        limit = 20,
        patientId,
        status = 'active',
        startDate,
        endDate,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // 构建查询条件
      const query = { userId, status };
      if (patientId) query.patientId = patientId;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      // 计算分页
      const skip = (page - 1) * limit;

      // 执行查询
      const [files, total] = await Promise.all([
        FileMetadata.find(query)
          .populate('patientId', 'name dateOfBirth gender')
          .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
          .limit(parseInt(limit))
          .skip(skip)
          .lean(),
        FileMetadata.countDocuments(query)
      ]);

      // 增强数据
      const enhancedFiles = await Promise.all(
        files.map(async (file) => {
          const currentVersion = file.versions[file.currentVersion] || {};
          return {
            id: file._id,
            patient: file.patientId,
            fileName: file.originalName,
            fileSize: file.fileSize,
            mimeType: file.mimeType,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            versionCount: file.versions.length,
            currentVersion: file.currentVersion,
            backupStatus: file.backupStatus,
            accessCount: file.accessCount,
            lastAccessed: file.lastAccessed,
            status: file.status,
            tags: file.tags,
            // 当前版本信息
            extractedTextPreview: this._generateTextPreview(currentVersion.extractedText),
            structuredDataSummary: this._generateDataSummary(currentVersion.structuredData),
            ocrMetadata: currentVersion.ocrMetadata
          };
        })
      );

      res.json({
        success: true,
        data: {
          files: enhancedFiles,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Get user history failed', { error, userId: req.userId });
      next(new AppError('获取历史记录失败', 500));
    }
  }

  /**
   * 获取文件详情
   * 包含完整版本历史和元数据
   */
  async getFileDetails(req, res, next) {
    try {
      const { fileId } = req.params;
      const userId = req.userId;

      // 查找文件
      const file = await FileMetadata.findOne({ _id: fileId, userId })
        .populate('patientId')
        .lean();

      if (!file) {
        return next(new AppError('文件不存在或无访问权限', 404));
      }

      // 更新访问统计
      await FileMetadata.findByIdAndUpdate(fileId, {
        $inc: { accessCount: 1 },
        lastAccessed: new Date()
      });

      // 构建完整的文件详情
      const fileDetails = {
        id: file._id,
        patient: file.patientId,
        fileInfo: {
          name: file.originalName,
          size: file.fileSize,
          type: file.mimeType,
          checksum: file.checksum,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt
        },
        versionHistory: file.versions.map((version, index) => ({
          versionId: version.versionId,
          versionIndex: index,
          isCurrent: index === file.currentVersion,
          createdAt: version.createdAt,
          fileSize: version.fileSize,
          checksum: version.checksum,
          ocrMetadata: version.ocrMetadata,
          // 数据预览
          textPreview: this._generateTextPreview(version.extractedText),
          dataSummary: this._generateDataSummary(version.structuredData)
        })),
        backupStatus: file.backupStatus,
        accessStats: {
          count: file.accessCount,
          lastAccessed: file.lastAccessed
        },
        tags: file.tags,
        retention: file.retention
      };

      res.json({
        success: true,
        data: fileDetails
      });
    } catch (error) {
      logger.error('Get file details failed', { error, fileId: req.params.fileId });
      next(new AppError('获取文件详情失败', 500));
    }
  }

  /**
   * 版本对比
   * 详细展示两个版本之间的差异
   */
  async compareVersions(req, res, next) {
    try {
      const { fileId } = req.params;
      const { version1, version2 } = req.query;
      const userId = req.userId;

      if (!version1 || !version2) {
        return next(new AppError('需要指定两个版本进行对比', 400));
      }

      // 查找文件
      const file = await FileMetadata.findOne({ _id: fileId, userId });
      if (!file) {
        return next(new AppError('文件不存在或无访问权限', 404));
      }

      // 执行版本对比
      const comparison = file.compareVersions(parseInt(version1), parseInt(version2));

      if (!comparison) {
        return next(new AppError('版本不存在', 404));
      }

      // 增强对比结果
      const enhancedComparison = {
        fileInfo: {
          id: file._id,
          name: file.originalName
        },
        versions: {
          v1: {
            index: parseInt(version1),
            versionId: file.versions[version1].versionId,
            createdAt: file.versions[version1].createdAt
          },
          v2: {
            index: parseInt(version2),
            versionId: file.versions[version2].versionId,
            createdAt: file.versions[version2].createdAt
          }
        },
        differences: {
          text: comparison.textDiff,
          data: comparison.dataDiff,
          metadata: this._compareMetadata(comparison.metadata.v1, comparison.metadata.v2)
        },
        summary: {
          textChanges: this._countTextChanges(comparison.textDiff),
          dataChanges: this._countDataChanges(comparison.dataDiff)
        }
      };

      res.json({
        success: true,
        data: enhancedComparison
      });
    } catch (error) {
      logger.error('Compare versions failed', { error, fileId: req.params.fileId });
      next(new AppError('版本对比失败', 500));
    }
  }

  /**
   * 获取版本数据
   * 返回指定版本的完整数据
   */
  async getVersionData(req, res, next) {
    try {
      const { fileId, versionIndex } = req.params;
      const userId = req.userId;
      const { includeFile = false } = req.query;

      // 查找文件
      const file = await FileMetadata.findOne({ _id: fileId, userId });
      if (!file) {
        return next(new AppError('文件不存在或无访问权限', 404));
      }

      const version = file.getVersion(parseInt(versionIndex));
      if (!version) {
        return next(new AppError('版本不存在', 404));
      }

      const versionData = {
        versionId: version.versionId,
        versionIndex: parseInt(versionIndex),
        isCurrent: parseInt(versionIndex) === file.currentVersion,
        createdAt: version.createdAt,
        extractedText: version.extractedText,
        structuredData: version.structuredData,
        ocrMetadata: version.ocrMetadata,
        fileSize: version.fileSize,
        checksum: version.checksum
      };

      // 如果需要文件内容
      if (includeFile === 'true') {
        try {
          const fileContent = await FileStorageService.readFile(file.storagePath);
          versionData.fileContent = fileContent.toString('base64');
          versionData.mimeType = file.mimeType;
        } catch (error) {
          logger.warn('Failed to read file content', { error, fileId });
          versionData.fileContent = null;
        }
      }

      res.json({
        success: true,
        data: versionData
      });
    } catch (error) {
      logger.error('Get version data failed', { error, fileId: req.params.fileId });
      next(new AppError('获取版本数据失败', 500));
    }
  }

  /**
   * 数据导出
   * 支持多种格式和筛选条件
   */
  async exportData(req, res, next) {
    try {
      const userId = req.userId;
      const {
        format = 'json',
        patientId,
        startDate,
        endDate,
        includeFiles = false,
        versionSelection = 'latest' // latest, all, specific
      } = req.query;

      // 构建查询条件
      const query = { userId, status: 'active' };
      if (patientId) query.patientId = patientId;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      // 获取数据
      const files = await FileMetadata.find(query)
        .populate('patientId', 'name dateOfBirth gender medicalRecordNumber')
        .lean();

      // 根据格式导出数据
      let exportData;
      let filename;
      let contentType;

      switch (format.toLowerCase()) {
        case 'csv':
          exportData = this._exportToCSV(files);
          filename = `medical_history_${Date.now()}.csv`;
          contentType = 'text/csv';
          break;

        case 'excel':
          exportData = await this._exportToExcel(files);
          filename = `medical_history_${Date.now()}.xlsx`;
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          break;

        case 'json':
        default:
          exportData = this._exportToJSON(files, { includeFiles, versionSelection });
          filename = `medical_history_${Date.now()}.json`;
          contentType = 'application/json';
          break;
      }

      // 设置响应头
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(exportData));

      res.send(exportData);
    } catch (error) {
      logger.error('Export data failed', { error, userId: req.userId });
      next(new AppError('数据导出失败', 500));
    }
  }

  /**
   * 获取存储统计
   */
  async getStorageStats(req, res, next) {
    try {
      const userId = req.userId;

      // 获取用户存储统计
      const [fileStats, cloudStats] = await Promise.all([
        FileMetadata.getStorageStats(userId),
        CloudStorageService.getCloudStorageStats()
      ]);

      const stats = {
        files: fileStats[0] || {
          totalFiles: 0,
          totalSize: 0,
          avgFileSize: 0,
          cloudBackupCount: 0
        },
        cloud: cloudStats,
        usage: {
          localStorage: fileStats[0]?.totalSize || 0,
          cloudStorage: cloudStats.totalSize,
          backupCoverage: fileStats[0]?.totalFiles > 0
            ? (fileStats[0].cloudBackupCount / fileStats[0].totalFiles * 100).toFixed(2)
            : 0
        }
      };

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Get storage stats failed', { error, userId: req.userId });
      next(new AppError('获取存储统计失败', 500));
    }
  }

  // 辅助方法

  _generateTextPreview(text, maxLength = 200) {
    if (!text) return '';
    return text.length > maxLength
      ? text.substring(0, maxLength) + '...'
      : text;
  }

  _generateDataSummary(data) {
    if (!data || typeof data !== 'object') return {};

    const summary = {};
    const keyCount = {};

    // 统计各类型数据的数量
    Object.keys(data).forEach(key => {
      const value = data[key];
      if (Array.isArray(value)) {
        keyCount[key] = value.length;
      } else if (typeof value === 'object' && value !== null) {
        keyCount[key] = Object.keys(value).length;
      } else {
        keyCount[key] = 1;
      }
    });

    return {
      totalFields: Object.keys(data).length,
      fieldCounts: keyCount,
      hasExtractedData: Object.keys(data).length > 0
    };
  }

  _compareMetadata(meta1, meta2) {
    const differences = {};

    Object.keys(meta1).forEach(key => {
      if (meta1[key] !== meta2[key]) {
        differences[key] = {
          old: meta1[key],
          new: meta2[key]
        };
      }
    });

    Object.keys(meta2).forEach(key => {
      if (!(key in meta1)) {
        differences[key] = {
          old: null,
          new: meta2[key]
        };
      }
    });

    return differences;
  }

  _countTextChanges(textDiff) {
    return {
      added: textDiff.added.length,
      removed: textDiff.removed.length,
      unchanged: textDiff.unchanged.length
    };
  }

  _countDataChanges(dataDiff) {
    return {
      added: dataDiff.added.length,
      removed: dataDiff.removed.length,
      modified: dataDiff.modified.length,
      unchanged: dataDiff.unchanged.length
    };
  }

  _exportToJSON(files, options) {
    const { includeFiles, versionSelection } = options;

    const exportData = files.map(file => {
      const baseData = {
        fileId: file._id,
        patient: file.patientId,
        fileInfo: {
          name: file.originalName,
          size: file.fileSize,
          type: file.mimeType,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt
        },
        backupStatus: file.backupStatus,
        tags: file.tags
      };

      // 版本数据
      if (versionSelection === 'latest') {
        const currentVersion = file.versions[file.currentVersion];
        baseData.currentVersion = {
          versionId: currentVersion.versionId,
          createdAt: currentVersion.createdAt,
          extractedText: currentVersion.extractedText,
          structuredData: currentVersion.structuredData,
          ocrMetadata: currentVersion.ocrMetadata
        };
      } else if (versionSelection === 'all') {
        baseData.versions = file.versions;
      }

      return baseData;
    });

    return JSON.stringify(exportData, null, 2);
  }

  _exportToCSV(files) {
    // CSV导出的简单实现
    const headers = ['文件ID', '患者姓名', '文件名称', '文件大小', '创建时间', '备份状态'];
    const rows = files.map(file => [
      file._id,
      file.patientId?.name || '',
      file.originalName,
      file.fileSize,
      file.createdAt,
      file.backupStatus.cloud ? '已备份' : '未备份'
    ]);

    return [headers, ...rows].map(row =>
      Array.isArray(row) ? row.join(',') : row
    ).join('\n');
  }

  async _exportToExcel(files) {
    // Excel导出需要使用第三方库，这里仅作示例结构
    // 实际项目中可以使用 exceljs 或类似库
    return JSON.stringify({
      files: files.length,
      message: 'Excel export requires exceljs library'
    }, null, 2);
  }
}

module.exports = new HistoryController();
