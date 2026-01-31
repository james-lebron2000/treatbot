module.exports = {
  apps: [
    {
      name: 'trial-match-frontend',
      cwd: './client',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'trial-match-medical-api',
      cwd: './server',
      script: './index.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        APP_MODE: 'production',
        PORT: 5002,
        MONGODB_URI: 'mongodb://localhost:27017/clinicalmatch',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        REDIS_TLS: 'false',
        PYTHON_OCR_URL: 'http://localhost:5001',
        ALLOW_OCR_MOCK: 'false'
      }
    },
    {
      name: 'trial-match-ocr',
      cwd: './python_ocr_service',
      script: 'ocr_server.py',
      interpreter: 'python3',
      exec_mode: 'fork',
      instances: 1,
      env: {
        FLASK_ENV: 'production',
        FLASK_DEBUG: 'false',
        OCR_PORT: 5001,
        REDIS_URL: 'redis://127.0.0.1:6379/0'
      }
    }
  ]
};
