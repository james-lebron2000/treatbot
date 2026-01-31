const express = require('express');
const router = express.Router();

// =============================================================================
// 健康检查 / Health Check
// =============================================================================
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'clinical-trial-matching-api',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// =============================================================================
// API路由 / API Routes
// =============================================================================

// 认证相关 / Authentication
router.use('/auth', require('./auth'));

// 医疗记录相关 / Medical records
router.use('/medical', require('./medical'));

// 患者管理相关 / Patient management
router.use('/patients', require('./patients'));

// 上传进度相关 / Upload progress
router.use('/upload-progress', require('./uploadProgress'));

// 临床试验相关 / Clinical trials
router.use('/trials', require('./trials'));

// 用户管理相关 / User management
router.use('/users', require('./users'));

// =============================================================================
// 错误处理中间件 / Error Handling Middleware
// =============================================================================

// 404处理 / 404 Handler
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND'
  });
});

// 全局错误处理 / Global error handler
router.use((err, req, res, next) => {
  console.error('Global error handler:', err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const code = err.code || 'INTERNAL_ERROR';

  res.status(status).json({
    success: false,
    message,
    code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = router;