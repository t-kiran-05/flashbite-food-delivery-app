/**
 * Order Routes.
 *
 * POST /orders        � Create order (JWT + tenantScope + orderLimiter)
 *                       Saves to MongoDB, publishes to Kafka "order_created"
 * GET  /orders/recent � Get last 10 orders for tenant from Redis cache
 * GET  /orders        � List all orders for tenant from MongoDB (paginated)
 *
 * Merges:
 *   - legacy routes/orders.js (Kafka publish, Redis cache read, rate limiting)
 *   - skeleton routes/order.routes.js (Mongoose Order model, tenantScope)
 */
"use strict";
const express = require("express");
const { body, query, validationResult } = require("express-validator");

const Order = require("../models/order.model");
const { verifyJWT } = require("../middleware/auth");
const { tenantScope } = require("../middleware/tenant");
const { orderLimiter } = require("../middleware/rateLimiter");
const { publishOrderCreated } = require("../services/kafkaProducer");
const redisClient = require("../services/redisClient");

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /orders � create order
// ---------------------------------------------------------------------------
router.post(
  "/",
  verifyJWT,
  tenantScope,
  orderLimiter,
  [
    body("items").isArray({ min: 1 }).withMessage("items must be a non-empty array"),
    body("items.*.name").isString().notEmpty().withMessage("each item needs a name"),
    body("items.*.price").isNumeric().withMessage("each item needs a numeric price"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { items, restaurantId, prepTimeSeconds } = req.body;
    const tenantId = req.tenantId;
    // const customerId = req.user.userId;
    // Ensure req.user structure in middleware/auth.js sets userId from JWT payload
    const customerId = req.user.userId || req.user.id; 

    const total = items.reduce((sum, item) => sum + item.price * (item.qty || 1), 0);

    try {
      const order = await Order.create({
        tenantId,
        customerId,
        restaurantId: restaurantId || null,
        items,
        total,
        status: "placed",
        prepTimeSeconds: prepTimeSeconds || 0,
      });

      // Publish to Kafka (consumed by kafkaConsumer which updates Redis + emits Socket.IO)
      await publishOrderCreated({
        orderId: order._id.toString(),
        tenantId,
        status: order.status,
        prepTimeSeconds: order.prepTimeSeconds,
      });

      res.status(201).json({ message: "Order created", order });
    } catch (err) {
      console.error("Create order error:", err);
      res.status(500).json({ error: "Failed to create order." });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /orders/recent � last 10 orders from Redis
// ---------------------------------------------------------------------------
router.get("/recent", verifyJWT, tenantScope, async (req, res) => {
  const key = `orders:${req.tenantId}:last10`;
  try {
    const raw = await redisClient.lRange(key, 0, -1);
    const orders = raw.map((item) => JSON.parse(item));
    res.json(orders);
  } catch (err) {
    console.error("Recent orders fetch error:", err);
    res.status(500).json({ error: "Failed to fetch recent orders." });
  }
});

// ---------------------------------------------------------------------------
// GET /orders � paginated order list from MongoDB
// ---------------------------------------------------------------------------
router.get(
  "/",
  verifyJWT,
  tenantScope,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    try {
      const [orders, total] = await Promise.all([
        Order.find({ tenantId: req.tenantId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Order.countDocuments({ tenantId: req.tenantId }),
      ]);
      res.json({ orders, total, page, limit });
    } catch (err) {
      console.error("List orders error:", err);
      res.status(500).json({ error: "Failed to list orders." });
    }
  }
);

module.exports = router;
