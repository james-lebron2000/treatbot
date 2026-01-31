const crypto = require('crypto');
const logger = require('../utils/logger');

function normalizePhone(phoneRaw = '') {
  const trimmed = String(phoneRaw || '').trim();
  // Accept +86xxxxxxxxxxx or 1xxxxxxxxxx (CN) for now.
  if (/^\+?86\d{11}$/.test(trimmed)) {
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  }
  if (/^1\d{10}$/.test(trimmed)) {
    return `+86${trimmed}`;
  }
  // Generic E.164
  if (/^\+\d{8,15}$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function generateOtpCode() {
  // 6 digits
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function sendOtp({ phone, code }) {
  const provider = String(process.env.SMS_PROVIDER || 'mock').toLowerCase();

  if (provider === 'mock') {
    // DO NOT use in production. This logs OTP to server logs.
    logger.info({ phone, otpCode: code }, 'Mock SMS provider: OTP generated');
    return { provider, messageId: `mock_${sha256(`${phone}:${code}`).slice(0, 12)}` };
  }

  // Placeholder for real providers (Aliyun/Tencent/etc.)
  // Keep the interface stable; implement later behind env flags.
  throw new Error(`SMS provider not configured: ${provider}`);
}

module.exports = {
  normalizePhone,
  generateOtpCode,
  sendOtp
};
