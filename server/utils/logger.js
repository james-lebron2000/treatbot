const path = require('path');
const fs = require('fs');
const { createLogger, format, transports } = require('winston');
const requestContext = require('./requestContext');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const defaultLevel = process.env.NODE_ENV === 'test'
  ? 'error'
  : (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const level = process.env.LOG_LEVEL || defaultLevel;

const injectRequestContext = format((info) => {
  const ctx = requestContext.get();
  if (ctx) {
    if (info.traceId === undefined && typeof ctx.traceId === 'string') {
      info.traceId = ctx.traceId;
    }
    if (info.userId === undefined && typeof ctx.userId === 'string') {
      info.userId = ctx.userId;
    }
    if (info.role === undefined && typeof ctx.role === 'string') {
      info.role = ctx.role;
    }
  }
  return info;
});

const consoleFormat = format.combine(
  injectRequestContext(),
  format.colorize({ all: true }),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaString}`;
  })
);

const jsonFormat = format.combine(
  injectRequestContext(),
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

const logger = createLogger({
  level,
  defaultMeta: {
    env: process.env.NODE_ENV || 'development',
    service: 'clinicalmatch-backend'
  },
  transports: [
    new transports.Console({
      level,
      // Keep tests quiet by default; opt in with LOG_LEVEL.
      silent: process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL,
      format: process.env.NODE_ENV === 'production' ? jsonFormat : consoleFormat
    }),
    ...(process.env.NODE_ENV === 'test' ? [] : [
      new transports.File({
        filename: path.join(LOG_DIR, 'application.log'),
        level: 'info',
        format: jsonFormat,
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
      })
    ])
  ]
});

module.exports = logger;
