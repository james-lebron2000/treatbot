const logger = require('../utils/logger');

function extractStatus(err) {
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (typeof err.status === 'number') return err.status;
  return 500;
}

module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = extractStatus(err);
  const isServerError = statusCode >= 500;
  const message = isServerError ? 'Internal server error' : err.message || 'Request failed';
  const code = err.code || (isServerError ? 'internal_error' : undefined);

  logger.error({ err, statusCode, reqId: req.id }, message);

  return res.status(statusCode).json({
    success: false,
    message,
    code,
    details: !isServerError ? err.details : undefined,
    traceId: req.id
  });
};
