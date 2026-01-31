/**
 * 历史记录路由
 * 处理用户数据持久化和回看功能相关API
 */

const express = require('express');
const router = express.Router();
const historyController = require('../controllers/historyController');
const { authenticateToken } = require('../middleware/auth');

// 所有历史记录相关路由都需要认证
router.use(authenticateToken);

/**
 * GET /api/history
 * 获取用户历史记录列表
 * @query {number} page - 页码，默认1
 * @query {number} limit - 每页数量，默认20
 * @query {string} patientId - 患者ID筛选
 * @query {string} status - 状态筛选 (active/archived/deleted)
 * @query {string} startDate - 开始日期
 * @query {string} endDate - 结束日期
 * @query {string} sortBy - 排序字段
 * @query {string} sortOrder - 排序顺序 (asc/desc)
 */
router.get('/', historyController.getUserHistory);

/**
 * GET /api/history/stats
 * 获取用户存储统计
 */
router.get('/stats', historyController.getStorageStats);

/**
 * GET /api/history/export
 * 导出历史数据
 * @query {string} format - 导出格式 (json/csv/excel)
 * @query {string} patientId - 患者ID筛选
 * @query {string} startDate - 开始日期
 * @query {string} endDate - 结束日期
 * @query {boolean} includeFiles - 是否包含文件内容
 * @query {string} versionSelection - 版本选择 (latest/all/specific)
 */
router.get('/export', historyController.exportData);

/**
 * GET /api/history/:fileId
 * 获取文件详情
 * @param {string} fileId - 文件ID
 */
router.get('/:fileId', historyController.getFileDetails);

/**
 * GET /api/history/:fileId/compare
 * 版本对比
 * @param {string} fileId - 文件ID
 * @query {number} version1 - 基础版本索引
 * @query {number} version2 - 对比版本索引
 */
router.get('/:fileId/compare', historyController.compareVersions);

/**
 * GET /api/history/:fileId/versions/:versionIndex
 * 获取指定版本数据
 * @param {string} fileId - 文件ID
 * @param {number} versionIndex - 版本索引
 * @query {boolean} includeFile - 是否包含文件内容
 */
router.get('/:fileId/versions/:versionIndex', historyController.getVersionData);

module.exports = router;
