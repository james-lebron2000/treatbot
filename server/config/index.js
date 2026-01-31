const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFiles = [];

const serverEnvPath = path.join(__dirname, '../.env');
if (fs.existsSync(serverEnvPath)) {
  envFiles.push(serverEnvPath);
}

const rootEnvPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  envFiles.push(rootEnvPath);
}

// load base env files first
envFiles.forEach((file) => dotenv.config({ path: file }));

const mode = (process.env.APP_MODE || process.env.NODE_ENV || '').trim();
if (mode) {
  const serverModePath = path.join(__dirname, `../.env.${mode}`);
  const rootModePath = path.join(__dirname, '..', '..', `.env.${mode}`);
  [serverModePath, rootModePath]
    .filter((file) => fs.existsSync(file))
    .forEach((file) => dotenv.config({ path: file, override: true }));
}

const required = new Set(['MONGODB_URI', 'JWT_SECRET']);

const strictMode = String(process.env.STRICT_MODE || '').toLowerCase() === 'true'
  || String(process.env.APP_MODE || process.env.NODE_ENV || '').trim() === 'strict';
const requireLLM = strictMode || String(process.env.REQUIRE_LLM || '').toLowerCase() === 'true';

if (requireLLM) {
  required.add('OPENAI_API_KEY');
}

// In strict mode, also require Alibaba OCR credentials (used by the Python OCR service and health checks).
if (strictMode) {
  required.add('ALIBABA_ACCESS_KEY_ID');
  required.add('ALIBABA_ACCESS_KEY_SECRET');
}

const missing = Array.from(required).filter((key) => !process.env[key]);
if (missing.length) {
  const message = `Missing required environment variables: ${missing.join(', ')}`;
  console.error(message);
  throw new Error(message);
}

if (requireLLM && String(process.env.LLM_PHI_MODE || '').toLowerCase() === 'disallow') {
  const message = 'Invalid configuration: REQUIRE_LLM/STRICT_MODE requires LLM usage, but LLM_PHI_MODE=disallow blocks sending text to LLM.';
  console.error(message);
  throw new Error(message);
}

const config = {
  port: Number(process.env.PORT) || 5001,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  appMode: mode || 'development',
  strictMode: String(process.env.STRICT_MODE || '').toLowerCase() === 'true' || mode === 'strict',
  pythonOcrUrl: process.env.PYTHON_OCR_URL || 'http://localhost:5002',
  moonshot: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.baseURL || 'https://api.moonshot.cn/v1'
  },
  uploads: {
    requirePatientId: process.env.UPLOAD_REQUIRE_PATIENT_ID === 'true',
    legacyFallback: process.env.UPLOAD_LEGACY_FALLBACK !== 'false'
  },
  ocr: {
    // Safety default: disallow mock/fallback unless explicitly enabled.
    allowMockFallback: String(process.env.ALLOW_OCR_MOCK || '').toLowerCase() === 'true',
    allowTesseractFallback: String(process.env.ALLOW_OCR_TESSERACT_FALLBACK || '').toLowerCase() === 'true'
  },
  trialCsvPath: process.env.TRIAL_CSV_PATH
    || path.join(__dirname, '..', '..', 'data', 'clinical_trials', 'liver_cancer_trials.csv'),
  cors: {
    origins: process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
      : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: process.env.CORS_ALLOW_CREDENTIALS !== 'false',
    methods: process.env.CORS_ALLOWED_METHODS || 'GET,HEAD,PUT,PATCH,POST,DELETE'
  },
  auth: {
    accessTokenTtl: process.env.JWT_EXPIRES_IN || '7d'
  },
  llm: {
    required: String(process.env.REQUIRE_LLM || '').toLowerCase() === 'true'
  },
  parsing: {
    // Whether to fallback to rule-based parsing when LLM is requested but fails.
    // In strict mode, defaults to false.
    allowFallback: String(process.env.ALLOW_PARSING_FALLBACK || '').toLowerCase() === 'true'
  }
};

// Derived defaults that depend on strictMode
if (config.strictMode) {
  config.ocr.allowMockFallback = false;
  config.ocr.allowTesseractFallback = false;
  config.parsing.allowFallback = false;
  config.llm.required = true;
} else {
  // Non-strict defaults: be helpful in dev unless explicitly disabled
  if (process.env.ALLOW_OCR_TESSERACT_FALLBACK === undefined) {
    config.ocr.allowTesseractFallback = true;
  }
  if (process.env.ALLOW_PARSING_FALLBACK === undefined) {
    config.parsing.allowFallback = true;
  }
}

module.exports = config;
