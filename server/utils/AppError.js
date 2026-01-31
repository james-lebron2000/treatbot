class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'APP_ERROR', metadata = null) {
    super(message);
    this.name = 'AppError';
    this.status = statusCode;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.metadata = metadata;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
