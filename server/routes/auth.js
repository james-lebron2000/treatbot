const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { User } = require('../models');
const config = require('../config');
const { rateLimit } = require('../middleware/rateLimiter');
const { authenticateToken } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { BadRequestError, HttpError, UnauthorizedError } = require('../utils/httpError');
const { normalizePhone, generateOtpCode, sendOtp } = require('../services/smsService');
const crypto = require('crypto');

const router = express.Router();

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

const registrationSchema = z.object({
  email: z.string().trim().email(),
  password: passwordSchema,
  name: z.string().trim().min(1),
  acceptComplianceSecurityAgreement: z.boolean().refine((value) => value === true, {
    message: 'Compliance & security agreement must be accepted'
  })
});

const loginSchema = registrationSchema.pick({ email: true, password: true });

// Phone OTP auth
const phoneSchema = z.object({
  phone: z.string().trim().min(6)
});
const requestOtpSchema = phoneSchema;
const verifyOtpSchema = phoneSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, 'Invalid OTP code')
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;

const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 300); // 5 min
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30);
const OTP_MAX_FAILED_ATTEMPTS = Number(process.env.OTP_MAX_FAILED_ATTEMPTS || 5);

function issueToken(userId) {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.auth.accessTokenTtl });
}

function normalizePhoneForUser(user) {
  if (!user) return null;
  return user.phone ? String(user.phone) : null;
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email,
    phone: normalizePhoneForUser(user),
    name: user.name,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined
  };
}

// Register
router.post('/register', rateLimit('register', { points: 5, duration: 60 }), asyncHandler(async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid input', { details: parsed.error.issues });
  }
  const { email, password, name } = parsed.data;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new BadRequestError('User already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = new User({
    email,
    password: hashedPassword,
    name,
    lastLoginAt: new Date(),
    consents: {
      complianceSecurityAgreement: {
        accepted: true,
        version: String(process.env.COMPLIANCE_SECURITY_AGREEMENT_VERSION || '2025-12-18'),
        acceptedAt: new Date(),
        ip: req.ip || null,
        userAgent: req.get('user-agent') || null
      }
    }
  });

  await user.save();

  const token = issueToken(user._id);

  logger.info({ userId: user._id, email: user.email }, 'User registered');

  return res.success({
    token,
    user: toPublicUser(user)
  }, { status: 201, message: 'User created successfully' });
}));

// Phone OTP - request code
router.post('/otp/request', rateLimit('otp_request', { points: 10, duration: 60 }), asyncHandler(async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid input', { details: parsed.error.issues });
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  if (!normalizedPhone) {
    throw new BadRequestError('Invalid phone number');
  }

  // Find or create a user for this phone.
  // Keep email required in schema for backward compatibility: we create a synthetic email.
  // NOTE: In production you may want to allow email=null; for now we keep the existing model.
  let user = await User.findOne({ phone: normalizedPhone });
  if (!user) {
    const syntheticEmail = `phone_${crypto.randomBytes(8).toString('hex')}@phone.local`;
    const syntheticPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
    user = new User({
      email: syntheticEmail,
      password: syntheticPassword,
      name: '用户',
      phone: normalizedPhone,
      consents: {
        complianceSecurityAgreement: {
          accepted: false,
          version: null,
          acceptedAt: null,
          ip: req.ip || null,
          userAgent: req.get('user-agent') || null
        }
      }
    });
  }

  const lastRequestedAt = user.otp?.lastRequestedAt ? new Date(user.otp.lastRequestedAt).getTime() : 0;
  if (lastRequestedAt && (Date.now() - lastRequestedAt) < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    throw new HttpError(429, 'OTP requested too frequently. Please try again later.', {
      code: 'otp_rate_limited',
      details: { retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS }
    });
  }

  const code = generateOtpCode();
  const hash = crypto.createHash('sha256').update(`${normalizedPhone}:${code}:${config.jwtSecret}`).digest('hex');
  user.otp = {
    hash,
    expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    failedAttempts: 0,
    lastRequestedAt: new Date()
  };

  await user.save();

  await sendOtp({ phone: normalizedPhone, code });

  return res.success({
    phone: normalizedPhone,
    ttlSeconds: OTP_TTL_SECONDS
  }, { message: 'OTP sent' });
}));

// Phone OTP - verify code
router.post('/otp/verify', rateLimit('otp_verify', { points: 20, duration: 60 }), asyncHandler(async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid input', { details: parsed.error.issues });
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  if (!normalizedPhone) {
    throw new BadRequestError('Invalid phone number');
  }

  const user = await User.findOne({ phone: normalizedPhone });
  if (!user) {
    throw new BadRequestError('Invalid credentials');
  }

  const otp = user.otp || {};
  if (!otp.hash || !otp.expiresAt) {
    throw new BadRequestError('OTP not requested');
  }

  if (otp.expiresAt && otp.expiresAt < new Date()) {
    user.otp = { hash: null, expiresAt: null, failedAttempts: 0, lastRequestedAt: otp.lastRequestedAt || null };
    await user.save();
    throw new BadRequestError('OTP expired');
  }

  if ((otp.failedAttempts || 0) >= OTP_MAX_FAILED_ATTEMPTS) {
    throw new HttpError(429, 'Too many failed OTP attempts. Please request a new code.', {
      code: 'otp_locked'
    });
  }

  const expected = crypto.createHash('sha256').update(`${normalizedPhone}:${parsed.data.code}:${config.jwtSecret}`).digest('hex');
  if (expected !== otp.hash) {
    user.otp.failedAttempts = (otp.failedAttempts || 0) + 1;
    await user.save();
    throw new BadRequestError('Invalid credentials');
  }

  user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
  user.otp = { hash: null, expiresAt: null, failedAttempts: 0, lastRequestedAt: otp.lastRequestedAt || null };
  user.lastLoginAt = new Date();
  await user.save();

  const token = issueToken(user._id);
  return res.success({ token, user: toPublicUser(user) }, { message: 'Login successful' });
}));

// Login
router.post('/login', rateLimit('login', { points: 10, duration: 60 }), asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid input', { details: parsed.error.issues });
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email });
  if (!user) {
    throw new BadRequestError('Invalid credentials');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    const unlocksIn = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw new HttpError(429, 'Account locked due to multiple failed attempts. Please try again later.', {
      code: 'account_locked',
      details: { retryAfterMinutes: unlocksIn > 0 ? unlocksIn : 1 }
    });
  }

  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCK_WINDOW_MINUTES * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw new BadRequestError('Invalid credentials');
  }

  const token = issueToken(user._id);

  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  logger.info({ userId: user._id, email: user.email }, 'User logged in');

  return res.success({
    token,
    user: toPublicUser(user)
  }, { message: 'Login successful' });
}));

// Get current user
router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new UnauthorizedError('Invalid or expired token');
  }
  return res.success(toPublicUser(user));
}));

// Update profile
router.patch('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).optional(),
    email: z.string().trim().email().optional()
  }).refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'At least one field must be provided'
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid input', { details: parsed.error.issues });
  }

  const user = await User.findById(req.userId);
  if (!user) {
    throw new UnauthorizedError('Invalid or expired token');
  }

  const nextEmail = parsed.data.email;
  if (nextEmail && nextEmail !== user.email) {
    const existingUser = await User.findOne({ email: nextEmail });
    if (existingUser && String(existingUser._id) !== String(user._id)) {
      throw new BadRequestError('Email already in use');
    }
    user.email = nextEmail;
  }

  if (parsed.data.name) {
    user.name = parsed.data.name;
  }

  await user.save();

  logger.info({ userId: user._id }, 'User profile updated');

  return res.success({
    message: 'Profile updated successfully',
    user: toPublicUser(user)
  });
}));

// Change password
router.post('/change-password', authenticateToken, rateLimit('change_password', { points: 5, duration: 60 }), asyncHandler(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema
  }).refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword']
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid input', { details: parsed.error.issues });
  }

  const user = await User.findById(req.userId);
  if (!user) {
    throw new UnauthorizedError('Invalid or expired token');
  }

  const isValidPassword = await bcrypt.compare(parsed.data.currentPassword, user.password);
  if (!isValidPassword) {
    throw new BadRequestError('Current password is incorrect');
  }

  user.password = await bcrypt.hash(parsed.data.newPassword, 12);
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  logger.info({ userId: user._id }, 'User password changed');

  return res.success({ message: 'Password changed successfully' });
}));

module.exports = router;
