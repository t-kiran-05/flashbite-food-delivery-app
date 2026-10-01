/**
 * @file src/scripts/seedAdmin.js
 * @description One-time/idempotent database seed script that creates or updates
 *              the platform Super Admin user for FlashBite.
 *
 * Run with:
 *   node src/scripts/seedAdmin.js
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('../models/User');

const ADMIN_EMAIL    = 'admin@flashbite.com';
const ADMIN_PASSWORD = 'AdminSecret123!';
const BCRYPT_ROUNDS  = 10;

async function seedAdmin() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error(
      '[Seed] ERROR: MONGO_URI is not defined in process.env. ' +
      'Check your .env file in the root directory.'
    );
    process.exit(1);
  }

  console.log('[Seed] Connecting to MongoDB…');

  try {
    await mongoose.connect(mongoUri);
    console.log(`[Seed] Connected to database: ${mongoose.connection.host}`);

    // Generate fresh hash for AdminSecret123!
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

    // Upsert user directly to guarantee correct hashed password & role
    const adminUser = await User.findOneAndUpdate(
      { email: ADMIN_EMAIL.toLowerCase() },
      {
        $set: {
          name: 'Super Admin',
          email: ADMIN_EMAIL.toLowerCase(),
          password: hashedPassword,
          role: 'SUPER_ADMIN',
          tenantId: null,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    console.log(
      `[Seed] ✅ Super Admin account configured successfully!\n` +
      `         Email   : ${adminUser.email}\n` +
      `         Password: ${ADMIN_PASSWORD}\n` +
      `         Role    : ${adminUser.role}\n`
    );

  } catch (err) {
    console.error(`[Seed] An error occurred during seeding: ${err.message}`);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
      console.log('[Seed] Disconnected from MongoDB. Done.');
    } catch (disconnectErr) {
      console.error(`[Seed] Error disconnecting: ${disconnectErr.message}`);
    }
  }
}

if (require.main === module) {
  seedAdmin();
}