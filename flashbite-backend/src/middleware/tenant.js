/**
 * @file src/middleware/tenant.js
 * @description Tenant-scoping middleware for the FlashBite multi-tenant API.
 *
 * In a multi-tenant architecture, every database query for tenant-owned
 * resources (orders, menus, etc.) MUST be filtered by the tenant identifier
 * to prevent one restaurant's data from leaking into another's responses.
 *
 * `tenantScope` is the enforcement point for this contract.  It reads the
 * `tenantId` that `verifyJWT` already extracted from the JWT payload,
 * copies it to `req.tenantId` for convenient use in downstream controllers,
 * and rejects any request that arrives without a valid tenant identity.
 *
 * Middleware chain order (example):
 *   router.get('/orders', verifyJWT, tenantScope, ordersController.list);
 *
 * After `tenantScope` runs, controllers can safely write:
 *   Order.find({ tenantId: req.tenantId, ... })
 * without having to re-read or validate the tenant identity themselves.
 */

'use strict';

// ---------------------------------------------------------------------------
// tenantScope
// ---------------------------------------------------------------------------

/**
 * tenantScope
 * -----------
 * Express middleware that ensures the authenticated request is associated with
 * a known tenant.
 *
 * Prerequisites:
 *  - `verifyJWT` must run before this middleware so that `req.user` is set.
 *
 * On success:
 *  - Sets `req.tenantId` to the non-null tenant slug from `req.user.tenantId`.
 *  - Calls `next()` to pass control to the next handler in the chain.
 *
 * On failure:
 *  - Returns **403 Forbidden** with a descriptive JSON error body when
 *    `req.user.tenantId` is null, undefined, or an empty string.
 *    This covers:
 *      • CUSTOMER users (tenantId is null by design – they have no restaurant).
 *      • SUPER_ADMIN users calling tenant-scoped routes without impersonation.
 *      • Any JWT that was issued without a tenantId claim.
 *
 * @param {import('express').Request}      req  - Express request object (must have req.user).
 * @param {import('express').Response}     res  - Express response object.
 * @param {import('express').NextFunction} next - Express next function.
 */
function tenantScope(req, res, next) {
  // Defensive check: verifyJWT should always run first, but guard anyway.
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Authentication is required before tenant scoping.',
    });
  }

  const tenantId = req.user.tenantId;

  // Reject requests from users who have no tenant association.
  // An empty string is treated the same as null/undefined.
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message:
        'Forbidden: This endpoint requires a tenant-scoped identity. ' +
        'Your account is not associated with any restaurant tenant.',
    });
  }

  /**
   * Expose tenantId at the top level of the request object so that
   * controllers can access it as `req.tenantId` rather than the longer
   * `req.user.tenantId`.  Both paths are equivalent; the shorthand is
   * a readability convention throughout the codebase.
   */
  req.tenantId = tenantId;

  return next();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { tenantScope };
