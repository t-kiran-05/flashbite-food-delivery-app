/**
 * @file src/middleware/auth.js
 * @description JWT authentication and role-based authorization middleware
 *              for the FlashBite multi-tenant API.
 *
 * Exports three middleware helpers:
 *
 *   1. verifyJWT        – Validates the Bearer token and populates req.user.
 *   2. requireRole(...) – Factory that returns a middleware enforcing role membership.
 *   3. requireSuperAdmin – Convenience shorthand for requireRole('SUPER_ADMIN').
 *
 * Typical usage in a route file:
 *   const { verifyJWT, requireRole, requireSuperAdmin } = require('../middleware/auth');
 *
 *   router.get('/admin-only',  verifyJWT, requireSuperAdmin,               handler);
 *   router.get('/tenant-data', verifyJWT, requireRole('RESTAURANT_ADMIN'), handler);
 */

'use strict';

const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Secret used to sign and verify JWTs.
 * In production this MUST be overridden by the JWT_SECRET env variable with a
 * cryptographically random value of at least 32 bytes.  The hard-coded
 * fallback exists only to ease local development without a .env file.
 */
const JWT_SECRET = process.env.JWT_SECRET || 'flashbite_secret_change_me';

// ---------------------------------------------------------------------------
// 1. verifyJWT
// ---------------------------------------------------------------------------

/**
 * verifyJWT
 * ---------
 * Express middleware that authenticates incoming requests by verifying the
 * JWT supplied in the `Authorization` header as a Bearer token.
 *
 * On success, populates `req.user` with the decoded payload:
 *   {
 *     userId  : string   – MongoDB ObjectId of the authenticated user
 *     role    : string   – One of CUSTOMER | RESTAURANT_ADMIN | SUPER_ADMIN
 *     tenantId: string|null – Restaurant slug (null for CUSTOMER/SUPER_ADMIN)
 *   }
 *
 * On failure:
 *   401 UNAUTHORIZED – Header absent or malformed.
 *   403 FORBIDDEN    – Token present but invalid / expired / tampered.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function verifyJWT(req, res, next) {
  // Extract the raw Authorization header value
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  // Ensure the header is present and follows the "Bearer <token>" format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: No token provided. Supply a Bearer token in the Authorization header.',
    });
  }

  // Slice off the "Bearer " prefix to get the raw JWT string
  const token = authHeader.slice(7); // "Bearer ".length === 7

  try {
    // Verify signature and expiry; throws on any failure
    const decoded = jwt.verify(token, JWT_SECRET);

    /**
     * Attach only the fields the rest of the application needs.
     * Avoids inadvertently exposing sensitive payload fields on req.user
     * if the token ever contained additional claims.
     */
    req.user = {
      userId:   decoded.userId,
      role:     decoded.role,
      tenantId: decoded.tenantId || null,
    };

    return next();
  } catch (err) {
    // jwt.verify throws JsonWebTokenError, TokenExpiredError, NotBeforeError
    return res.status(403).json({
      success: false,
      message: `Forbidden: Token is invalid or expired. (${err.message})`,
    });
  }
}

// ---------------------------------------------------------------------------
// 2. requireRole (factory)
// ---------------------------------------------------------------------------

/**
 * requireRole
 * -----------
 * Higher-order function that returns an Express middleware enforcing that the
 * authenticated user's role is one of the allowed roles.
 *
 * Must be used AFTER `verifyJWT` in the middleware chain, as it depends on
 * `req.user` being populated.
 *
 * @param  {...string} roles – One or more allowed role strings.
 * @returns {import('express').RequestHandler}
 *
 * @example
 *   // Allow only RESTAURANT_ADMIN and SUPER_ADMIN
 *   router.post('/menu', verifyJWT, requireRole('RESTAURANT_ADMIN', 'SUPER_ADMIN'), handler);
 */
function requireRole(...roles) {
  /**
   * Inner middleware returned to Express.
   * Checks whether req.user.role is in the `roles` closure array.
   */
  return function roleGuard(req, res, next) {
    // Safety check: verifyJWT should always run first
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required before role check.',
      });
    }

    // Check membership in the allowed roles list
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This action requires one of the following roles: [${roles.join(', ')}]. Your role is '${req.user.role}'.`,
      });
    }

    return next();
  };
}

// ---------------------------------------------------------------------------
// 3. requireSuperAdmin (convenience shorthand)
// ---------------------------------------------------------------------------

/**
 * requireSuperAdmin
 * -----------------
 * Pre-built middleware that restricts access to SUPER_ADMIN users only.
 * Equivalent to `requireRole('SUPER_ADMIN')` but more ergonomic in route files
 * that frequently protect platform-level endpoints.
 *
 * @type {import('express').RequestHandler}
 *
 * @example
 *   router.delete('/tenants/:id', verifyJWT, requireSuperAdmin, handler);
 */
const requireSuperAdmin = requireRole('SUPER_ADMIN');

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  verifyJWT,
  requireRole,
  requireSuperAdmin,
};
