class HttpError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

class NotFoundError extends HttpError {
  constructor(message = 'Resource not found', options) {
    super(404, message, options);
  }
}

class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', options) {
    super(401, message, options);
  }
}

class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', options) {
    super(403, message, options);
  }
}

class BadRequestError extends HttpError {
  constructor(message = 'Bad request', options) {
    super(400, message, options);
  }
}

module.exports = {
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError
};
