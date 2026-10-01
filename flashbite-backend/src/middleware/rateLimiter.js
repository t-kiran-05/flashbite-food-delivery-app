/**
 * Rate Limiter Middleware (Redis-backed).
 *
 * globalLimiter  � 200 req/minute per tenant+IP (applied globally in app.js)
 * orderLimiter   � 50 req/minute per tenant (applied to POST /orders)
 *
 * Uses rate-limit-redis store so limits survive process restarts
 * and are shared across multiple backend instances.
 */
"use strict";
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const redisClient = require("../services/redisClient");

/** Shared helper to create a Redis-backed rate limiter. */
function createLimiter({ windowMs, max, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // rate-limit-redis v4 requires a sendCommand wrapper
    store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    keyGenerator,
    message: { error: message || "Too many requests, please try again later." },
  });
}

/**
 * Global rate limiter: 200 requests per 60 seconds per tenant+IP.
 * Applied in app.js before all routes.
 */
const globalLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: (req) => `rl:global:${req.user?.tenantId || "public"}:${req.ip}`,
  message: "Rate limit exceeded. Max 200 requests per minute.",
});

/**
 * Order route limiter: 50 requests per 15 minutes per tenantId.
 * Applied to POST /orders.
 */
const orderLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => `rl:orders:${req.tenantId || req.user?.tenantId || req.ip}`,
  message: "Order rate limit exceeded. Max 50 orders per 15 minutes.",
});

module.exports = { globalLimiter, orderLimiter };
