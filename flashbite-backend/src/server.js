/**
 * @file src/server.js
 * @description FlashBite API — main HTTP server entry point.
 *
 *              Responsibilities:
 *               1. Boot sequence: MongoDB → HTTP listen → Kafka producer → Telemetry pipeline
 *               2. Create Socket.IO server on the same HTTP server (shared port)
 *               3. Socket.IO JWT auth middleware (handshake token verification)
 *               4. Socket.IO room assignment by role (CUSTOMER / RESTAURANT_ADMIN / SUPER_ADMIN)
 *               5. Graceful shutdown on SIGTERM / SIGINT
 */

'use strict';

// ─── Environment Bootstrap ────────────────────────────────────────────────────
// Must be the very first statement so all env vars are available before any
// module is imported (some modules read env at require-time).
require('dotenv').config();

// Suppress KafkaJS v2.0 informational partitioner-change warning.
// The warning is cosmetic only and does not indicate an error.
process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';



const http = require('http');
const { Server: IOServer } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// ─── Application Imports ──────────────────────────────────────────────────────
/** Express application (routes, middleware, static files). */
const app = require('./app');

/** MongoDB connection helper. */
const connectDB = require('./config/db');

/** Kafka producer lifecycle helpers. */
const { connectProducer, disconnectProducer } = require('./services/kafkaProducer');

/** Real-time telemetry consumer + Socket.IO bridge. */
const { initTelemetryPipeline } = require('./services/telemetryPipeline');

// ─── Constants ────────────────────────────────────────────────────────────────
/** HTTP port. Uses process.env.PORT (e.g. on Render/Heroku/Vercel) or defaults to 5000. */
const PORT = parseInt(process.env.PORT || '5000', 10);

/**
 * JWT secret — must match the secret used to sign tokens in auth.js.
 * In production this MUST be set via environment variable.
 */
const JWT_SECRET = process.env.JWT_SECRET || 'flashbite_secret_change_me';

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Server + Socket.IO Setup
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Attach Socket.IO to the Node.js http.Server so that REST requests
 * and WebSocket upgrades share the same port.
 */
const server = http.createServer(app);

const socketOrigins = process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || '*';

const io = new IOServer(server, {
  cors: {
    origin: socketOrigins === '*' ? '*' : socketOrigins.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Expose io instance to Express routes
app.set('io', io);
app.locals.io = io;


// ═══════════════════════════════════════════════════════════════════════════════
// Socket.IO — JWT Authentication Middleware
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Every WebSocket connection must present a valid JWT in the handshake.
 * The token is read from `socket.handshake.auth.token`.
 *
 * On success: `socket.user` is populated with the decoded JWT payload
 *             ({ userId, role, tenantId }).
 * On failure: the connection is rejected with a descriptive error code.
 */
io.use((socket, next) => {
  // ── 1. Extract token from handshake ───────────────────────────────────────
  const token = socket.handshake.auth?.token;

  if (!token) {
    // No token provided — reject immediately
    console.warn(`[SOCKET] Connection rejected (no token) — socket ${socket.id}`);
    return next(new Error('AUTH_MISSING'));
  }

  // ── 2. Verify the JWT ─────────────────────────────────────────────────────
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Attach the decoded payload to the socket for use in event handlers
    socket.user = decoded; // { userId, role, tenantId }

    return next(); // Proceed to connection handler
  } catch (err) {
    console.warn(`[SOCKET] Connection rejected (invalid token) — socket ${socket.id}:`, err.message);
    return next(new Error('AUTH_INVALID'));
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Socket.IO — Connection Handler
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Fired once for every authenticated WebSocket connection.
 * Assigns the socket to the appropriate rooms based on the user's role and
 * registers event listeners for client-initiated actions.
 */
io.on('connection', (socket) => {
  // Destructure the JWT payload attached by the auth middleware
  const { role, tenantId, userId } = socket.user;

  console.log(
    `[SOCKET] Client connected — socket ${socket.id} | role: ${role} | userId: ${userId} | tenantId: ${tenantId || 'N/A'}`
  );

  // ── Room Assignment by Role ─────────────────────────────────────────────────
  switch (role) {
    case 'CUSTOMER':
      /**
       * Customers are placed in their personal user room.
       * They can additionally join specific order rooms after placing an order
       * by emitting the 'join:order' event.
       */
      socket.join(`user:${userId}`);
      console.log(`[SOCKET] CUSTOMER ${userId} joined room: user:${userId}`);
      break;

    case 'RESTAURANT_ADMIN':
      /**
       * Restaurant admins are placed in their tenant room so they receive
       * all order events for their restaurant automatically.
       */
      socket.join(`tenant:${tenantId}`);
      console.log(`[SOCKET] RESTAURANT_ADMIN joined room: tenant:${tenantId}`);
      break;

    case 'SUPER_ADMIN':
      /**
       * Super admins join the global admin room which receives a copy of
       * every order event across all tenants.
       */
      socket.join('admin:global');
      console.log(`[SOCKET] SUPER_ADMIN joined room: admin:global`);
      break;

    default:
      // Unknown role — allow connection but place in no rooms
      console.warn(`[SOCKET] Unknown role "${role}" for socket ${socket.id}`);
  }

  // ── Event: 'join:order' ─────────────────────────────────────────────────────
  /**
   * Allows clients to subscribe to real-time updates for a specific order.
   *
   * Payload: { orderId: string }
   *
   * CUSTOMER:          May only join order rooms for orders that follow the
   *                    FlashBite orderId format (basic validation).
   * RESTAURANT_ADMIN / SUPER_ADMIN:  May join any order room.
   */
  socket.on('join:order', ({ orderId } = {}) => {
    if (!orderId || typeof orderId !== 'string') {
      console.warn(`[SOCKET] Invalid join:order payload from socket ${socket.id}`);
      return;
    }

    if (role === 'CUSTOMER') {
      // Basic format check: orderId must start with 'ORD-'
      if (!orderId.startsWith('ORD-')) {
        console.warn(`[SOCKET] CUSTOMER ${userId} attempted to join invalid order room: ${orderId}`);
        return;
      }
    }

    // Join the order-specific room
    socket.join(`order:${orderId}`);
    console.log(
      `[SOCKET] Socket ${socket.id} (${role}) joined room: order:${orderId}`
    );

    // Acknowledge the join to the client
    socket.emit('joined:order', { orderId, room: `order:${orderId}` });
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(
      `[SOCKET] Client disconnected — socket ${socket.id} | userId: ${userId} | reason: ${reason}`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// startServer()
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Asynchronous boot sequence:
 *  1. Connect to MongoDB
 *  2. Start HTTP listener
 *  3. Connect Kafka producer (non-blocking on failure — app still runs)
 *  4. Initialise telemetry pipeline (non-blocking on failure)
 *  5. Log all accessible URLs for development convenience
 *
 * @returns {Promise<void>}
 */
async function startServer() {
  // ── 1. MongoDB Connection ──────────────────────────────────────────────────
  console.log('[BOOT] Connecting to MongoDB…');
  await connectDB();
  console.log('[BOOT] MongoDB connected ✓');

  // ── 2. HTTP Server Listen ──────────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    server.listen(PORT, async () => {
      console.log(`\n[BOOT] FlashBite API listening on port ${PORT}`);

      // ── 3. Kafka Producer ─────────────────────────────────────────────────
      try {
        await connectProducer();
        console.log('[BOOT] Kafka producer ready ✓');
      } catch (kafkaErr) {
        // Producer failure is non-fatal — API can still serve HTTP requests.
        // Orders will still be saved to MongoDB; Kafka events will be retried
        // via the lazy-connect mechanism in publishToKafka.
        console.error('[BOOT] Kafka producer failed to connect (non-fatal):', kafkaErr.message);
      }

      // ── 4. Telemetry Pipeline ─────────────────────────────────────────────
      try {
        await initTelemetryPipeline(io);
        console.log('[BOOT] Telemetry pipeline active ✓');
      } catch (telemetryErr) {
        // Similarly non-fatal — real-time updates will be unavailable but
        // the REST API remains fully functional.
        console.error('[BOOT] Telemetry pipeline failed to start (non-fatal):', telemetryErr.message);
      }

      // ── 5. Log accessible URLs ────────────────────────────────────────────
      const base = `http://localhost:${PORT}`;
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(' FlashBite API — Ready');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(` API Base:        ${base}/api`);
      console.log(` Health Check:    ${base}/health`);
      console.log(` Auth — Login:    POST ${base}/api/auth/login`);
      console.log(` Auth — Register: POST ${base}/api/auth/register`);
      console.log(` Orders:          POST ${base}/api/orders`);
      console.log(` Admin Branches:  GET  ${base}/api/admin/branches`);
      console.log(' ── Pages ───────────────────────────────────');
      console.log(` Login page:      ${base}/login`);
      console.log(` Customer page:   ${base}/customer`);
      console.log(` Restaurant page: ${base}/restaurant`);
      console.log(` Admin page:      ${base}/admin`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      resolve();
    });

    server.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Shared shutdown handler for SIGTERM and SIGINT.
 *
 * Order of operations:
 *  1. Stop accepting new HTTP connections (server.close)
 *  2. Disconnect Kafka producer (flush pending messages)
 *  3. Disconnect MongoDB (release connection pool)
 *  4. Exit with code 0
 *
 * @param {string} signal - The OS signal that triggered shutdown.
 */
async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal} — shutting down gracefully…`);

  // Stop accepting new HTTP connections; existing ones are allowed to finish.
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed.');
  });

  // ── Disconnect Kafka producer ─────────────────────────────────────────────
  try {
    await disconnectProducer();
    console.log('[SHUTDOWN] Kafka producer disconnected ✓');
  } catch (err) {
    console.error('[SHUTDOWN] Error disconnecting Kafka producer:', err.message);
  }

  // ── Disconnect MongoDB ────────────────────────────────────────────────────
  try {
    await mongoose.disconnect();
    console.log('[SHUTDOWN] MongoDB disconnected ✓');
  } catch (err) {
    console.error('[SHUTDOWN] Error disconnecting MongoDB:', err.message);
  }

  console.log('[SHUTDOWN] Clean exit.');
  process.exit(0);
}

// Register shutdown handlers for both POSIX signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─── Boot ─────────────────────────────────────────────────────────────────────
/**
 * Kick off the boot sequence.
 * Any unhandled error during startup causes a logged exit with code 1.
 */
startServer().catch((err) => {
  console.error('[BOOT] Fatal startup error:', err);
  process.exit(1);
});