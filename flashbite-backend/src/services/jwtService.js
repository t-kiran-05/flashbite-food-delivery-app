/**
 * JWT Service.
 * Centralises token signing and verification so all routes use the same secret and options.
 */
"use strict";
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "devsecret_change_me";
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Signs a JWT containing the given payload.
 * @param {object} payload - e.g. { userId, tenantId, role }
 * @returns {string} signed JWT
 */
function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

/**
 * Verifies a JWT string.
 * @param {string} token
 * @returns {object} decoded payload
 * @throws if invalid or expired
 */
function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
