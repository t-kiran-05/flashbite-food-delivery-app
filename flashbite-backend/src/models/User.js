/**
 * @file src/models/User.js
 * @description Mongoose schema and model for FlashBite platform users.
 *
 * Supports three roles:
 *   - CUSTOMER        : End-users who place orders.
 *   - RESTAURANT_ADMIN: Owners/managers of a specific restaurant tenant.
 *   - SUPER_ADMIN     : Platform-level administrators with full access.
 *
 * Passwords are never stored in plain text. A pre-save hook hashes any
 * modified password field using bcryptjs with a cost factor of 12.
 */

'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

const UserSchema = new mongoose.Schema(
  {
    /**
     * Display name of the user.
     * Trimmed to prevent leading/trailing whitespace issues.
     */
    name: {
      type:     String,
      required: [true, 'Name is required'],
      trim:     true,
    },

    /**
     * Unique email address used for authentication.
     * Stored in lowercase to ensure case-insensitive uniqueness.
     * Indexed for fast lookup during login.
     */
    email: {
      type:      String,
      required:  [true, 'Email is required'],
      unique:    true,
      index:     true,
      lowercase: true,
      trim:      true,
    },

    /**
     * Bcryptjs-hashed password string.
     * The raw password is NEVER stored; the pre-save hook handles hashing.
     * The `select: false` option omits this field from query results by
     * default, preventing accidental exposure in API responses.
     */
    password: {
      type:     String,
      required: [true, 'Password is required'],
      select:   false, // never returned in query results unless explicitly requested
    },

    /**
     * Platform role that drives authorization logic.
     *   CUSTOMER         – default for self-registered users
     *   RESTAURANT_ADMIN – assigned when a restaurant is created/claimed
     *   SUPER_ADMIN      – platform administrator; no tenant restriction
     */
    role: {
      type:    String,
      enum:    ['CUSTOMER', 'RESTAURANT_ADMIN', 'SUPER_ADMIN'],
      default: 'CUSTOMER',
    },

    /**
     * Tenant identifier (restaurant slug, e.g. "flashbite-downtown").
     * Null for CUSTOMER and SUPER_ADMIN users.
     * Sparse index allows multiple null values while enforcing uniqueness
     * for non-null entries (i.e. each admin belongs to exactly one tenant).
     */
    tenantId: {
      type:    String,
      default: null,
      index:   { sparse: true },
    },

    /**
     * Optional contact phone number for the user.
     */
    phone: {
      type:    String,
      default: null,
    },

    /**
     * Hashed password reset token.
     */
    resetPasswordToken: {
      type:    String,
      default: null,
    },

    /**
     * Expiration timestamp for password reset token.
     */
    resetPasswordExpires: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------------------------
// Pre-save hook – password hashing (with double-hash prevention)
// ---------------------------------------------------------------------------

UserSchema.pre('save', async function hashPasswordHook(next) {
  // Only re-hash when the password field was actually touched
  if (!this.isModified('password')) {
    return next();
  }

  // Guard against double-hashing if password is already a valid bcrypt hash
  if (typeof this.password === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(this.password)) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/**
 * comparePassword
 * Securely compares a plain-text candidate password against the stored hash.
 */
UserSchema.methods.comparePassword = async function comparePassword(plainPassword) {
  if (!plainPassword || !this.password) return false;
  return bcrypt.compare(plainPassword, this.password);
};

/**
 * createPasswordResetToken
 * Generates an unhashed token, stores the SHA-256 hashed version in the DB,
 * sets expiration to 1 hour, and returns the unhashed token for emailing/link.
 */
UserSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Store hashed version of token in DB for security
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Token expires in 1 hour
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000;

  return resetToken;
};

// ---------------------------------------------------------------------------
// Model export
// ---------------------------------------------------------------------------

module.exports = mongoose.model('User', UserSchema);
