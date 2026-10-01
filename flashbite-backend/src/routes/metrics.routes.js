/**
 * Metrics Routes.
 *
 * GET /metrics – Return aggregated metrics for tenant from Redis.
 *
 * Merges:
 *   - legacy routes/metrics.js (Redis lrange read)
 *   - skeleton routes/metrics.routes.js (Redis get with tenantId)
 *
 * The Kafka consumer (kafkaConsumer.js) continuously writes to:
 *   Redis key: "metrics:<tenantId>"  (JSON: ordersPerMin, totalOrders, avgPrepSeconds, lastCpu, lastMemory)
 *
 * This route returns the current aggregated snapshot.
 */
"use strict";
const express = require("express");
const redisClient = require("../services/redisClient");
const { verifyJWT } = require("../middleware/auth");
const { tenantScope } = require("../middleware/tenant");

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /metrics – aggregated tenant metrics from Redis
// ---------------------------------------------------------------------------
router.get("/", verifyJWT, tenantScope, async (req, res) => {
  const tenantId = req.tenantId;
  const key = `metrics:${tenantId}`;

  try {
    const raw = await redisClient.get(key);
    const metrics = raw
      ? JSON.parse(raw)
      : {
          ordersPerMin: 0,
          totalOrders: 0,
          avgPrepSeconds: 0,
          lastCpu: 0,
          lastMemory: 0,
          message: "No metrics yet. Place some orders to see data.",
        };

    res.json({ tenantId, metrics });
  } catch (err) {
    console.error("Get metrics error:", err);
    res.status(500).json({ error: "Failed to fetch metrics." });
  }
});

module.exports = router;
