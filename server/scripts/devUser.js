const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { User } = require('../models');
const config = require('../config');

async function main() {
  const email = process.env.DEV_USER_EMAIL || 'test@example.com';
  const password = process.env.DEV_USER_PASSWORD || 'password123';
  const name = process.env.DEV_USER_NAME || 'Test User';

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clinicalmatch');
    console.log('[devUser] Connected to MongoDB');

    let user = await User.findOne({ email });
    if (!user) {
      const hashed = await bcrypt.hash(password, 12);
      user = new User({ email, password: hashed, name });
      await user.save();
      console.log(`[devUser] Created user: ${email}`);
    } else {
      console.log(`[devUser] User already exists: ${email}`);
    }

    const token = jwt.sign(
      { userId: user._id },
      config.jwtSecret || process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: config.auth?.accessTokenTtl || '7d' }
    );

    console.log('--- Dev User Credentials ---');
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log('JWT:');
    console.log(token);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[devUser] Failed:', err);
    process.exit(1);
  }
}

main();
