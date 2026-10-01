/**
 * @file src/services/redisClient.js
 * @description Shared Redis client (redis v4 / @redis/client) with graceful non-blocking connection.
 *              Supports Upstash Cloud Redis (rediss:// with TLS) and local Redis.
 *
 * Resilience:
 *   - Non-blocking connection lifecycle.
 *   - If Redis is unreachable or offline, operations fail-safe (return null/0/no-op)
 *     without throwing unhandled promise rejections or crashing the API.
 */
"use strict";

const { createClient } = require("redis");

const rawUrl = process.env.REDIS_URL || process.env.REDIS_URI || process.env.UPSTASH_REDIS_REST_URL || "redis://localhost:6379";
// Normalize Upstash REST URL if provided by mistake (Upstash Redis requires rediss:// or redis:// for redis-node)
let redisUrl = rawUrl;
if (redisUrl.startsWith("https://")) {
  redisUrl = redisUrl.replace("https://", "rediss://");
}

const isCloudRedis = redisUrl.startsWith("rediss://");

let isConnectionLogged = false;
let isOfflineLogged = false;

const rawClient = createClient({
  url: redisUrl,
  socket: {
    tls: isCloudRedis ? { rejectUnauthorized: false } : undefined,
    reconnectStrategy: (retries) => {
      // Exponential backoff reconnect logic (max 3 seconds)
      if (retries > 5 && !isOfflineLogged) {
        console.warn("[REDIS WARN] Redis connection retries exceeded - operating in fallback mode");
        isOfflineLogged = true;
      }
      return Math.min(retries * 200, 3000);
    },
    connectTimeout: 5000,
  },
});

rawClient.on("error", (err) => {
  if (!isOfflineLogged) {
    console.warn(`[REDIS WARN] Redis client offline/unreachable: ${err.message || err}`);
    isOfflineLogged = true;
  }
});

rawClient.on("connect", () => {
  isOfflineLogged = false;
  if (!isConnectionLogged) {
    console.log(`⚡ Redis connected successfully (${isCloudRedis ? "TLS Enabled (Upstash)" : "Local/Standard"})`);
    isConnectionLogged = true;
  }
});

rawClient.on("reconnecting", () => {
  // Silent reconnecting state
});

/**
 * Safely initializes the Redis connection if not already open (non-blocking)
 */
async function connectRedis() {
  if (!rawClient.isOpen && !rawClient.isConnecting) {
    try {
      await rawClient.connect();
    } catch (err) {
      if (!isOfflineLogged) {
        console.warn(`[REDIS WARN] Redis connection failed (non-blocking fallback active): ${err.message}`);
        isOfflineLogged = true;
      }
    }
  }
}

// Eager non-blocking initial connection
connectRedis().catch(() => {});

/**
 * Safe Proxy / Wrapper around redisClient.
 * Intercepts common data methods (get, set, del, incrBy, etc.)
 * If Redis is offline or disconnected, returns safe defaults instead of throwing.
 */
const safeRedisClient = new Proxy(rawClient, {
  get(target, prop) {
    // If accessing connection state or event handlers, pass directly
    if (typeof prop !== "string" || prop in { isOpen: 1, isConnecting: 1, on: 1, once: 1, emit: 1, connect: 1, disconnect: 1, quit: 1 }) {
      return target[prop];
    }

    const orig = target[prop];
    if (typeof orig === "function") {
      return async function (...args) {
        if (!target.isOpen) {
          // Attempt lazy background reconnect if not connecting
          connectRedis().catch(() => {});

          // Return safe default responses based on operation
          if (prop === "get") return null;
          if (prop === "lRange") return [];
          if (prop === "incrBy" || prop === "incr") return 0;
          if (prop === "del" || prop === "set" || prop === "lPush" || prop === "lTrim") return null;
          return null;
        }

        try {
          return await orig.apply(target, args);
        } catch (err) {
          console.warn(`[REDIS WARN] Command "${prop}" failed safely: ${err.message}`);
          if (prop === "get") return null;
          if (prop === "lRange") return [];
          if (prop === "incrBy" || prop === "incr") return 0;
          return null;
        }
      };
    }

    return target[prop];
  },
});

module.exports = safeRedisClient;