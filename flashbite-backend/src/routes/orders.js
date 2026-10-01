/**
 * @file src/routes/orders.js
 * @description Order management routes for FlashBite multi-tenant ordering system.
 *              Handles order creation, cancellation, status updates, and admin metrics.
 *              Integrates with Kafka (event streaming), Redis (live counters), and Socket.IO.
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');

// ─── Middleware ────────────────────────────────────────────────────────────────
const { verifyJWT, requireRole, requireSuperAdmin } = require('../middleware/auth');

// ─── Models ───────────────────────────────────────────────────────────────────
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');

// ─── Services ─────────────────────────────────────────────────────────────────
const { publishToKafka } = require('../services/kafkaProducer');
const redisClient = require('../services/redisClient');

// ─── Constants ────────────────────────────────────────────────────────────────
const ORDER_EVENTS_TOPIC = 'order-events';

const VALID_STATUSES = [
  'ORDER_RECEIVED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
];

const CUSTOMER_CANCELLATION_REASONS = [
  'Changed my mind',
  'Placed order by mistake',
  'Delivery time is too long',
  'Ordered wrong items',
  'Other',
];

const RESTAURANT_CANCELLATION_REASONS = [
  'Item(s) out of stock',
  'Kitchen too busy / Over capacity',
  'Restaurant closing soon',
  'Special request cannot be fulfilled',
  'Other',
];

// ─── Helper: Format Validation Errors ────────────────────────────────────────
function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

// ─── Helper: Direct Socket.IO Broadcast ──────────────────────────────────────
function broadcastSocketEvent(req, eventName, room, payload) {
  const io = req.app.get('io') || req.app.locals.io;
  if (io && room) {
    io.to(room).emit(eventName, payload);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/orders  — Place new order (Customer only)
// ═══════════════════════════════════════════════════════════════════════════════
router.post(
  '/orders',
  verifyJWT,
  requireRole('CUSTOMER'),

  [
    body('tenantId')
      .trim()
      .notEmpty()
      .withMessage('tenantId is required.'),

    body('items')
      .isArray({ min: 1 })
      .withMessage('items must be a non-empty array.'),

    body('items.*.itemId')
      .notEmpty()
      .withMessage('Each item must include itemId.'),

    body('items.*.name')
      .trim()
      .notEmpty()
      .withMessage('Each item must include a name.'),

    body('items.*.price')
      .isFloat({ min: 0 })
      .withMessage('Each item price must be a non-negative number.'),

    body('items.*.quantity')
      .isInt({ min: 1 })
      .withMessage('Each item quantity must be at least 1.'),
  ],

  async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { tenantId, items } = req.body;
    const customerId = req.user.userId;

    try {
      const restaurant = await Restaurant.findOne({ tenantId, isActive: true });
      if (!restaurant) {
        return res.status(404).json({
          error: `Restaurant "${tenantId}" not found or is currently inactive.`,
        });
      }

      const orderId =
        'ORD-' +
        Date.now() +
        '-' +
        crypto.randomBytes(3).toString('hex').toUpperCase();

      const totalAmount = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      const order = await Order.create({
        orderId,
        tenantId,
        customerId,
        items,
        totalAmount: Math.round(totalAmount * 100) / 100,
        status: 'ORDER_RECEIVED',
      });

      await Restaurant.updateOne(
        { tenantId },
        { $inc: { totalOrdersCount: 1 } }
      );

      const kafkaPayload = {
        type: 'order-created',
        orderId: order.orderId,
        tenantId: order.tenantId,
        customerId: order.customerId,
        items: order.items,
        totalAmount: order.totalAmount,
        status: order.status,
        timestamp: order.createdAt,
      };

      try {
        await publishToKafka(ORDER_EVENTS_TOPIC, kafkaPayload);
      } catch (kafkaErr) {
        console.warn('[ORDERS WARN] Kafka publish failed (order saved to DB):', kafkaErr.message);
      }

      try {
        const redisKey = `branch:${tenantId}:orders`;
        await redisClient.incrBy(redisKey, 1);
      } catch (_) {}

      // Direct Socket fallback broadcast
      broadcastSocketEvent(req, 'order:new', `tenant:${tenantId}`, kafkaPayload);
      broadcastSocketEvent(req, 'order:status', `order:${orderId}`, kafkaPayload);
      broadcastSocketEvent(req, 'admin:order-stream', 'admin:global', kafkaPayload);

      return res.status(201).json({
        message: 'Order placed successfully.',
        order,
      });
    } catch (err) {
      console.error('[ORDERS] Error placing order:', err);
      return res.status(500).json({ error: 'Internal server error while placing order.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/orders/:orderId/cancel  — End-to-End Order Cancellation Workflow
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   POST /api/orders/:orderId/cancel
 * @desc    Cancel an order with role-based business rules & reason validation.
 *          - Customer: allowed only in 'ORDER_RECEIVED' state (before preparation).
 *          - Restaurant Admin: allowed in 'ORDER_RECEIVED' or 'PREPARING' states.
 *          - Super Admin: oversight cancellation for any non-delivered order.
 * @access  Private (CUSTOMER, RESTAURANT_ADMIN, SUPER_ADMIN)
 */
router.post(
  '/orders/:orderId/cancel',
  verifyJWT,

  [
    param('orderId')
      .trim()
      .notEmpty()
      .withMessage('orderId parameter is required.'),

    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Cancellation reason is required.'),
  ],

  async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { orderId } = req.params;
    const { reason, customReason } = req.body;
    const { role, userId, tenantId: userTenantId } = req.user;

    // Resolve final reason
    let finalReason = reason;
    if (reason === 'Other' && customReason && customReason.trim()) {
      finalReason = `Other: ${customReason.trim()}`;
    }

    try {
      const order = await Order.findOne({ orderId });
      if (!order) {
        return res.status(404).json({ error: `Order "${orderId}" not found.` });
      }

      // Check if already terminal
      if (order.status === 'CANCELLED') {
        return res.status(400).json({ error: 'This order has already been cancelled.' });
      }
      if (order.status === 'DELIVERED') {
        return res.status(400).json({ error: 'Delivered orders cannot be cancelled.' });
      }

      // ── Business Rule Checks by Role ───────────────────────────────────────
      if (role === 'CUSTOMER') {
        // Customer can only cancel their own orders
        if (order.customerId && order.customerId.toString() !== userId) {
          return res.status(403).json({ error: 'You are not authorized to cancel this order.' });
        }

        // Time window rule: Customer can only cancel before preparation starts
        if (order.status !== 'ORDER_RECEIVED') {
          return res.status(400).json({
            error: 'Orders can only be cancelled before the restaurant begins preparation.',
            currentStatus: order.status,
          });
        }
      } else if (role === 'RESTAURANT_ADMIN') {
        // Restaurant admin can only cancel orders belonging to their branch
        if (order.tenantId !== userTenantId) {
          return res.status(403).json({ error: 'You are not authorized to manage orders for this restaurant.' });
        }

        // Restaurant can cancel during ORDER_RECEIVED or PREPARING (not OUT_FOR_DELIVERY)
        if (order.status === 'OUT_FOR_DELIVERY') {
          return res.status(400).json({
            error: 'Orders that are already out for delivery cannot be cancelled by the kitchen.',
            currentStatus: order.status,
          });
        }
      }

      // ── Apply Cancellation ─────────────────────────────────────────────────
      const cancelledAt = new Date();
      order.status = 'CANCELLED';
      order.cancellationReason = finalReason;
      order.cancelledBy = role;
      order.cancelledAt = cancelledAt;
      await order.save();

      const cancelPayload = {
        type: 'order-cancelled',
        orderId: order.orderId,
        tenantId: order.tenantId,
        status: 'CANCELLED',
        cancelledBy: role,
        cancellationReason: finalReason,
        timestamp: cancelledAt.toISOString(),
      };

      // ── Event Publishing & WebSocket Broadcasts ────────────────────────────
      try {
        await publishToKafka(ORDER_EVENTS_TOPIC, cancelPayload);
      } catch (kafkaErr) {
        console.warn('[ORDERS WARN] Kafka publish failed (cancellation saved):', kafkaErr.message);
      }

      // Broadcast to all relevant Socket.IO channels
      broadcastSocketEvent(req, 'order:status', `order:${orderId}`, cancelPayload);
      broadcastSocketEvent(req, 'order:cancelled', `tenant:${order.tenantId}`, cancelPayload);
      broadcastSocketEvent(req, 'order:status-update', `tenant:${order.tenantId}`, cancelPayload);
      broadcastSocketEvent(req, 'admin:order-stream', 'admin:global', cancelPayload);

      // Audit Log
      const auditLogMsg = `ORDER_CANCELLED | ${orderId} | By: ${role} | Reason: "${finalReason}"`;
      broadcastSocketEvent(req, 'admin:telemetry-log', 'admin:global', {
        type: '[AUDIT]',
        message: auditLogMsg,
        timestamp: cancelledAt.toISOString(),
      });

      console.log(`[AUDIT] ${auditLogMsg}`);

      return res.status(200).json({
        message: 'Order cancelled successfully.',
        order,
      });
    } catch (err) {
      console.error('[ORDERS] Cancellation error:', err);
      return res.status(500).json({ error: 'Failed to cancel order.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/orders/:orderId/status  — Lifecycle Status Update
// ═══════════════════════════════════════════════════════════════════════════════
router.patch(
  '/orders/:orderId/status',
  verifyJWT,
  requireRole('RESTAURANT_ADMIN', 'SUPER_ADMIN'),

  [
    param('orderId')
      .trim()
      .notEmpty()
      .withMessage('orderId parameter is required.'),

    body('status')
      .notEmpty()
      .withMessage('status is required.')
      .isIn(VALID_STATUSES)
      .withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}.`),
  ],

  async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { orderId } = req.params;
    const { status, cancellationReason } = req.body;
    const { role, tenantId: adminTenantId } = req.user;

    try {
      const order = await Order.findOne({ orderId });
      if (!order) {
        return res.status(404).json({ error: `Order "${orderId}" not found.` });
      }

      if (role === 'RESTAURANT_ADMIN' && order.tenantId !== adminTenantId) {
        return res.status(403).json({ error: 'You are not authorized to update orders for this restaurant.' });
      }

      order.status = status;
      if (status === 'CANCELLED') {
        order.cancellationReason = cancellationReason || order.cancellationReason || 'Cancelled by restaurant';
        order.cancelledBy = role;
        order.cancelledAt = new Date();
      }

      await order.save();

      const kafkaPayload = {
        type: status === 'CANCELLED' ? 'order-cancelled' : 'order-updated',
        orderId: order.orderId,
        tenantId: order.tenantId,
        newStatus: status,
        status: order.status,
        cancellationReason: order.cancellationReason,
        cancelledBy: order.cancelledBy,
        timestamp: new Date().toISOString(),
      };

      try {
        await publishToKafka(ORDER_EVENTS_TOPIC, kafkaPayload);
      } catch (kafkaErr) {
        console.warn('[ORDERS WARN] Kafka publish failed (status saved):', kafkaErr.message);
      }

      broadcastSocketEvent(req, 'order:status', `order:${orderId}`, kafkaPayload);
      broadcastSocketEvent(req, 'order:status-update', `tenant:${order.tenantId}`, kafkaPayload);
      if (status === 'CANCELLED') {
        broadcastSocketEvent(req, 'order:cancelled', `tenant:${order.tenantId}`, kafkaPayload);
      }
      broadcastSocketEvent(req, 'admin:order-stream', 'admin:global', kafkaPayload);

      return res.status(200).json({ order });
    } catch (err) {
      console.error('[ORDERS] Error updating status:', err);
      return res.status(500).json({ error: 'Internal server error while updating status.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/orders/:orderId  — Single Order Query
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/orders/:orderId', verifyJWT, async (req, res) => {
  const { orderId } = req.params;
  const { role, userId, tenantId } = req.user;

  try {
    const order = await Order.findOne({ orderId }).lean();
    if (!order) {
      return res.status(404).json({ error: `Order "${orderId}" not found.` });
    }

    if (role === 'CUSTOMER' && order.customerId && order.customerId.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied to this order.' });
    }
    if (role === 'RESTAURANT_ADMIN' && order.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied to this order.' });
    }

    return res.status(200).json({ order });
  } catch (err) {
    console.error('[ORDERS] Error fetching order:', err);
    return res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/branches  — Public branch list
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/branches', async (req, res) => {
  try {
    const branches = await Restaurant.find({ isActive: true })
      .select('tenantId name location')
      .lean();
    return res.status(200).json({ branches });
  } catch (err) {
    console.error('[ORDERS] Error fetching branches:', err);
    return res.status(500).json({ error: 'Failed to fetch branches.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/branches  — Super Admin Branches Overview
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/admin/branches', verifyJWT, requireSuperAdmin, async (req, res) => {
  try {
    const restaurants = await Restaurant.find({}).lean();

    // Count non-delivered, non-cancelled active orders
    const activeAgg = await Order.aggregate([
      { $match: { status: { $in: ['ORDER_RECEIVED', 'PREPARING', 'OUT_FOR_DELIVERY'] } } },
      { $group: { _id: '$tenantId', count: { $sum: 1 } } },
    ]);
    const activeMap = {};
    activeAgg.forEach((a) => { activeMap[a._id] = a.count; });

    const branches = await Promise.all(
      restaurants.map(async (r) => {
        let liveOrderCount = 0;
        try {
          const val = await redisClient.get(`branch:${r.tenantId}:orders`);
          liveOrderCount = val ? parseInt(val, 10) : 0;
        } catch (_) {}

        return {
          tenantId: r.tenantId,
          name: r.name,
          location: r.location,
          isActive: r.isActive,
          totalOrdersCount: r.totalOrdersCount || 0,
          activeOrdersCount: activeMap[r.tenantId] || 0,
          liveOrderCount,
        };
      })
    );

    return res.status(200).json(branches);
  } catch (err) {
    console.error('[ORDERS] Error fetching branches:', err);
    return res.status(500).json({ error: 'Failed to fetch branches.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/metrics  — Platform Analytics
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/admin/metrics', verifyJWT, requireSuperAdmin, async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [c24h, c7d, c30d, active, cancelled] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: last24h } }),
      Order.countDocuments({ createdAt: { $gte: last7d } }),
      Order.countDocuments({ createdAt: { $gte: last30d } }),
      Order.countDocuments({ status: { $in: ['ORDER_RECEIVED', 'PREPARING', 'OUT_FOR_DELIVERY'] } }),
      Order.countDocuments({ status: 'CANCELLED' }),
    ]);

    return res.status(200).json({
      last24h: c24h,
      last7d:  c7d,
      last30d: c30d,
      active,
      cancelled,
    });
  } catch (err) {
    console.error('[ORDERS] Error fetching metrics:', err);
    return res.status(500).json({ error: 'Failed to fetch metrics.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/cancellations  — Full Cancellation Audit & Analytics
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   GET /api/admin/cancellations
 * @desc    Comprehensive cancellation metrics, breakdown by actor & reason,
 *          top cancelled restaurants, and audit log entries.
 * @access  Private — SUPER_ADMIN only
 */
router.get('/admin/cancellations', verifyJWT, requireSuperAdmin, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments({});
    const totalCancelled = await Order.countDocuments({ status: 'CANCELLED' });
    const cancellationRate = totalOrders > 0
      ? ((totalCancelled / totalOrders) * 100).toFixed(1) + '%'
      : '0.0%';

    // Breakdown by actor
    const actorAgg = await Order.aggregate([
      { $match: { status: 'CANCELLED' } },
      { $group: { _id: '$cancelledBy', count: { $sum: 1 } } },
    ]);
    const byActor = { CUSTOMER: 0, RESTAURANT_ADMIN: 0, SUPER_ADMIN: 0 };
    actorAgg.forEach((a) => {
      if (a._id) byActor[a._id] = a.count;
    });

    // Breakdown by reason
    const reasonAgg = await Order.aggregate([
      { $match: { status: 'CANCELLED' } },
      { $group: { _id: '$cancellationReason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const byReason = reasonAgg.map((r) => ({
      reason: r._id || 'Unspecified',
      count: r.count,
      percentage: totalCancelled > 0 ? ((r.count / totalCancelled) * 100).toFixed(1) + '%' : '0.0%',
    }));

    // Top restaurants by cancellations
    const restaurantCancelAgg = await Order.aggregate([
      { $match: { status: 'CANCELLED' } },
      { $group: { _id: '$tenantId', cancelledCount: { $sum: 1 } } },
      { $sort: { cancelledCount: -1 } },
      { $limit: 10 },
    ]);

    const topRestaurants = await Promise.all(
      restaurantCancelAgg.map(async (rc) => {
        const rest = await Restaurant.findOne({ tenantId: rc._id }).lean();
        const totalBranchOrders = await Order.countDocuments({ tenantId: rc._id });
        const rate = totalBranchOrders > 0
          ? ((rc.cancelledCount / totalBranchOrders) * 100).toFixed(1) + '%'
          : '0.0%';

        return {
          tenantId: rc._id,
          name: rest ? rest.name : rc._id,
          location: rest ? rest.location : 'N/A',
          cancelledCount: rc.cancelledCount,
          totalBranchOrders,
          rate,
        };
      })
    );

    // Recent cancellation audit logs
    const recentCancelledOrders = await Order.find({ status: 'CANCELLED' })
      .sort({ updatedAt: -1 })
      .limit(30)
      .populate('customerId', 'name email')
      .lean();

    const auditLogs = recentCancelledOrders.map((o) => ({
      orderId: o.orderId,
      tenantId: o.tenantId,
      customerName: o.customerId ? o.customerId.name : 'Guest',
      customerEmail: o.customerId ? o.customerId.email : '',
      totalAmount: o.totalAmount,
      cancelledBy: o.cancelledBy || 'UNKNOWN',
      cancellationReason: o.cancellationReason || 'No reason provided',
      cancelledAt: o.cancelledAt || o.updatedAt,
      createdAt: o.createdAt,
    }));

    return res.status(200).json({
      totalOrders,
      totalCancelled,
      cancellationRate,
      byActor,
      byReason,
      topRestaurants,
      auditLogs,
    });
  } catch (err) {
    console.error('[ORDERS] Error fetching cancellation analytics:', err);
    return res.status(500).json({ error: 'Failed to fetch cancellation analytics.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/orders/cleanup  — Wipe Stale Test Data
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/admin/orders/cleanup', verifyJWT, requireSuperAdmin, async (req, res) => {
  try {
    const { modifiedCount } = await Order.updateMany(
      { status: { $in: ['ORDER_RECEIVED', 'PREPARING', 'OUT_FOR_DELIVERY'] } },
      { $set: { status: 'DELIVERED' } }
    );

    return res.status(200).json({
      message: `Marked ${modifiedCount} orders as DELIVERED.`,
      modifiedCount,
    });
  } catch (err) {
    console.error('[ORDERS] Cleanup error:', err);
    return res.status(500).json({ error: 'Failed to clean orders.' });
  }
});

module.exports = router;
