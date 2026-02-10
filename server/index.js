const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const expressWinston = require('express-winston');
const config = require('./config');
const logger = require('./utils/logger');
const responseFormatter = require('./middleware/responseFormatter');
const errorHandler = require('./middleware/errorHandler');
const { pingRedis, isRedisEnabled } = require('./config/redis');
const { metricsMiddleware, metricsHandler } = require('./monitoring/metrics');
const requestContext = require('./utils/requestContext');

const app = express();
app.disable('x-powered-by');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

function resolveRequestId(req) {
  const header = req.get('x-request-id');
  if (typeof header === 'string') {
    const trimmed = header.trim();
    // Keep it bounded; avoid log injection / huge payloads.
    if (trimmed.length > 0 && trimmed.length <= 128) return trimmed;
  }
  return crypto.randomUUID();
}

const allowedOrigins = config.cors?.origins || [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const corsOptions = {
  origin(origin, callback) {
    // allow non-browser clients (curl/postman) with no Origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: Boolean(config.cors?.credentials),
  methods: config.cors?.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id']
};

// Middleware
app.use((req, res, next) => {
  req.id = resolveRequestId(req);
  res.setHeader('X-Request-Id', req.id);
  requestContext.run({ traceId: req.id }, () => next());
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: '{{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
  ignoreRoute: (req) => req.path.startsWith('/api/health')
}));
app.use(express.json());

app.use(responseFormatter);
app.use(metricsMiddleware);

app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.fail('Origin not allowed', { status: 403, code: 'cors_not_allowed' });
  }
  return next(err);
});

app.use('/uploads', express.static(UPLOADS_DIR));

// Import routes
function tryLoadRoute(relativePath) {
  const resolved = path.join(__dirname, relativePath);
  if (!fs.existsSync(resolved) && !fs.existsSync(`${resolved}.js`)) {
    logger.warn({ route: relativePath }, 'Optional route file not found – skipping mount');
    return null;
  }
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(relativePath);
  } catch (err) {
    logger.error({ route: relativePath, err }, 'Failed to load optional route – skipping');
    return null;
  }
}

const authRoutes = require('./routes/auth');
const medicalRoutes = require('./routes/medical');
const patientRoutes = require('./routes/patients');
const historyRoutes = tryLoadRoute('./routes/history');
const uploadProgressRoutes = require('./routes/uploadProgress');
const enhancedUploadRoutes = require('./routes/enhancedUpload');
const trialRoutes = tryLoadRoute('./routes/trials');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/medical', medicalRoutes);
app.use('/api/patients', patientRoutes);
if (historyRoutes) {
  app.use('/api/history', historyRoutes);
}
if (trialRoutes) {
  app.use('/api/trials', trialRoutes);
}
app.use('/api/upload-progress', uploadProgressRoutes);
app.use('/api/enhanced-upload', enhancedUploadRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const mongoReadyState = mongoose.connection.readyState;
  const mongoStatus = mongoReadyState === 1 ? 'connected' : 'disconnected';
  const redisEnabled = isRedisEnabled();
  const redisHealth = await pingRedis();
  const redisStatus = redisEnabled
    ? (redisHealth.ok ? 'connected' : `error: ${redisHealth.message}`)
    : 'disabled';

  const payload = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    mode: process.env.APP_MODE || process.env.NODE_ENV || 'mock',
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
      llm: {
        required: String(process.env.REQUIRE_LLM || '').toLowerCase() === 'true'
          || String(process.env.STRICT_MODE || '').toLowerCase() === 'true'
          || String(process.env.APP_MODE || '').toLowerCase() === 'strict',
        configured: Boolean(process.env.OPENAI_API_KEY),
        phiMode: String(process.env.LLM_PHI_MODE || 'full')
      },
      ocr: {
        pythonUrl: process.env.PYTHON_OCR_URL || 'http://localhost:5002'
      }
    }
  };

  res.success(payload, { message: 'Server is running' });
});

app.get('/api/metrics', async (req, res, next) => {
  try {
    await metricsHandler(req, res);
  } catch (err) {
    next(err);
  }
});

// Serve frontend build (optional production mode)
const clientBuildPath = path.join(__dirname, '../client/build');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    // avoid catching API routes
    if (req.path.startsWith('/api/')) {
      return res.fail('Not found', { status: 404, code: 'not_found' });
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.fail('Not found', { status: 404, code: 'not_found' });
  }
  return next();
});

app.use(expressWinston.errorLogger({
  winstonInstance: logger
}));
app.use(errorHandler);

async function start() {
  // Create uploads directory if it doesn't exist
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    logger.info({ uploadDir: UPLOADS_DIR }, 'Created uploads directory');
  }

  try {
    await mongoose.connect(config.mongoUri);
    logger.info('Connected to MongoDB');
  } catch (err) {
    logger.error({ err }, 'MongoDB connection error');
    throw err;
  }

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Server is running');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error({ port: config.port }, 'Port already in use. Set PORT to a free port and restart.');
      process.exit(1);
    }
    throw error;
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  });
}

module.exports = { app, start };
