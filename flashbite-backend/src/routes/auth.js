/**
 * @file src/routes/auth.js
 * @description Authentication routes for FlashBite multi-tenant ordering system.
 *              Handles user registration, login, forgot-password, and reset-password flows.
 *              Implements express-rate-limit and express-validator for robust security.
 */

'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

// ─── Model Imports ────────────────────────────────────────────────────────────
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { sendPasswordResetEmail } = require('../services/emailService');

// ─── Constants ────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'flashbite_secret_change_me';
const JWT_EXPIRY = '24h';

// Password Regex: 8-64 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character (@$!%*?&)
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/;

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // max 30 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});

// ─── Validation Rules ─────────────────────────────────────────────────────────
const registerValidators = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required.'),

  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required.')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 8, max: 64 })
    .withMessage('Password must be between 8 and 64 characters long.')
    .matches(PASSWORD_REGEX)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).'),

  body('accountType')
    .notEmpty()
    .withMessage('accountType is required.')
    .isIn(['CUSTOMER', 'RESTAURANT'])
    .withMessage('accountType must be either CUSTOMER or RESTAURANT.'),

  body('phone')
    .optional()
    .trim(),
];

const loginValidators = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required.')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required.'),
];

function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════════════════════════════════════════
router.post(
  '/register',
  authRateLimiter,
  registerValidators,
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { name, email, password, phone, accountType } = req.body;

    try {
      if (accountType === 'RESTAURANT') {
        const { restaurantName, restaurantLocation } = req.body;

        if (!restaurantName || !restaurantLocation) {
          return res.status(422).json({
            errors: [
              { msg: 'restaurantName is required for RESTAURANT accounts.' },
              { msg: 'restaurantLocation is required for RESTAURANT accounts.' },
            ].filter((e) => {
              if (!restaurantName && e.msg.includes('restaurantName')) return true;
              if (!restaurantLocation && e.msg.includes('restaurantLocation')) return true;
              return false;
            }),
          });
        }

        const tenantId = 'fb-' + crypto.randomBytes(4).toString('hex');

        // User model pre-save hook securely hashes password
        const user = await User.create({
          name,
          email,
          password,
          role: 'RESTAURANT_ADMIN',
          tenantId,
          phone: phone || undefined,
        });

        const restaurant = await Restaurant.create({
          tenantId,
          name: restaurantName,
          location: restaurantLocation,
          ownerId: user._id,
        });

        const token = signToken({
          userId: user._id.toString(),
          role: 'RESTAURANT_ADMIN',
          tenantId,
        });

        return res.status(201).json({
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
          },
          restaurant: {
            tenantId: restaurant.tenantId,
            name: restaurant.name,
            location: restaurant.location,
          },
        });
      }

      // CUSTOMER account - User model pre-save hook securely hashes password
      const user = await User.create({
        name,
        email,
        password,
        role: 'CUSTOMER',
        tenantId: null,
        phone: phone || undefined,
      });

      const token = signToken({
        userId: user._id.toString(),
        role: 'CUSTOMER',
        tenantId: null,
      });

      return res.status(201).json({
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          error: 'An account with this email address already exists.',
        });
      }

      console.error('[AUTH] Registration error:', err);
      return res.status(500).json({ error: 'Internal server error during registration.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════════════════════════
router.post(
  '/login',
  authRateLimiter,
  loginValidators,
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const token = signToken({
        userId: user._id.toString(),
        role: user.role,
        tenantId: user.tenantId || null,
      });

      return res.status(200).json({
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId || null,
        },
      });
    } catch (err) {
      console.error('[AUTH] Login error:', err);
      return res.status(500).json({ error: 'Internal server error during login.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/forgot-password', authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Generic response prevents email enumeration
    if (!user) {
      return res.status(200).json({
        message: 'If an account exists with that email, a password reset link has been generated.',
      });
    }

    const unhashedToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
    const resetUrl = `${clientUrl}/reset-password?token=${unhashedToken}`;

    // Dispatch email via Nodemailer (if SMTP configured in .env) and log link to console
    await sendPasswordResetEmail(user.email, resetUrl, user.name);

    return res.status(200).json({
      message: 'If an account exists with that email, a password reset link has been generated.',
    });
  } catch (error) {
    console.error('[AUTH] Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process forgot password request' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/reset-password
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/reset-password', authRateLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    // Password strength check
    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        error: 'Password must be 8-64 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).',
      });
    }

    // Hash incoming token to match database value
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired password reset token' });
    }

    // Assign plain password; User pre-save hook handles hashing properly without double-hashing
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return res.status(200).json({ message: 'Password reset successful. You can now log in with your new password.' });
  } catch (error) {
    console.error('[AUTH] Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
