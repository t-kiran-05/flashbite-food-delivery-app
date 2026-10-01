/**
 * @file src/services/telemetryPipeline.js
 * @description Kafka consumer pipeline for FlashBite real-time telemetry with graceful fallback.
 *              Consumes order events from Kafka, updates Redis counters, and
 *              fans out real-time notifications via Socket.IO rooms.
 *
 * Resilience:
 *   - Non-blocking initialization: If Kafka consumer connection fails or times out,
 *     logs a warning and continues without crashing.
 */

'use strict';

const { Kafka, logLevel } = require('kafkajs');
const fs = require('fs');
const path = require('path');

// ─── Redis Client ─────────────────────────────────────────────────────────────
const redisClient = require('./redisClient');

// ─── Environment Configuration ────────────────────────────────────────────────
const KAFKA_BROKERS_RAW = process.env.KAFKA_BROKERS || '';
const KAFKA_BROKERS = KAFKA_BROKERS_RAW
  ? KAFKA_BROKERS_RAW.split(',').map((b) => b.trim()).filter(Boolean)
  : ['localhost:9092'];

const KAFKA_USERNAME       = process.env.KAFKA_USERNAME || process.env.KAFKA_SASL_USERNAME || '';
const KAFKA_PASSWORD       = process.env.KAFKA_PASSWORD || process.env.KAFKA_SASL_PASSWORD || '';
const KAFKA_SASL_MECHANISM = (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256').toLowerCase();
const KAFKA_SSL            = process.env.KAFKA_SSL === 'true' || Boolean(KAFKA_USERNAME);
const KAFKA_CA_CERT_ENV    = process.env.KAFKA_CA_CERT || '';

// ─── SSL Certificate Loading ──────────────────────────────────────────────────
function loadCACert() {
  if (KAFKA_CA_CERT_ENV) {
    if (KAFKA_CA_CERT_ENV.startsWith('-----BEGIN')) return KAFKA_CA_CERT_ENV;
    try { return fs.readFileSync(KAFKA_CA_CERT_ENV); } catch (_) {}
  }
  const bundledPath = path.resolve(__dirname, '../../certs/ca.pem');
  if (fs.existsSync(bundledPath)) {
    try { return fs.readFileSync(bundledPath); } catch (_) {}
  }
  return null;
}

function buildSslConfig() {
  if (!KAFKA_SSL) return false;
  const ca = loadCACert();
  return ca ? { ca: [ca], rejectUnauthorized: true } : true;
}

function buildSaslConfig() {
  if (!KAFKA_USERNAME || !KAFKA_PASSWORD) return null;
  const supported = ['plain', 'scram-sha-256', 'scram-sha-512'];
  const mechanism = supported.includes(KAFKA_SASL_MECHANISM)
    ? KAFKA_SASL_MECHANISM
    : 'scram-sha-256';
  return { mechanism, username: KAFKA_USERNAME, password: KAFKA_PASSWORD };
}

function createKafkaClient(clientId) {
  const ssl  = buildSslConfig();
  const sasl = buildSaslConfig();

  return new Kafka({
    clientId,
    brokers: KAFKA_BROKERS,
    ssl: ssl || undefined,
    sasl: sasl || undefined,
    logLevel: process.env.NODE_ENV === 'production' ? logLevel.NOTHING : logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 3 },
  });
}

/**
 * Emits a structured telemetry log event to the admin:global Socket.IO room.
 */
function emitTelemetryLog(io, type, message) {
  if (!io) return;
  io.to('admin:global').emit('admin:telemetry-log', {
    type,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Initialises the telemetry Kafka consumer pipeline.
 * Non-blocking: Handles connection failures gracefully.
 *
 * @param {import('socket.io').Server} io - The Socket.IO server instance.
 * @returns {Promise<void>}
 */
async function initTelemetryPipeline(io) {
  const primaryKafka = createKafkaClient('flashbite-telemetry-consumer');
  const primaryConsumer = primaryKafka.consumer({
    groupId: 'flashbite-telemetry-group',
    heartbeatInterval: 3000,
    sessionTimeout: 30000,
  });

  try {
    await primaryConsumer.connect();
    console.log('[KAFKA] Telemetry consumer connected (group: flashbite-telemetry-group) ✓');

    await primaryConsumer.subscribe({
      topic: 'order-events',
      fromBeginning: false,
    });

    await primaryConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        let payload;

        try {
          payload = JSON.parse(message.value.toString());
        } catch (parseErr) {
          console.error('[KAFKA] Failed to parse message from topic', topic, ':', parseErr.message);
          return;
        }

        const { type, orderId, tenantId, newStatus } = payload;

        const kafkaLogMsg = `${type} - Order ${orderId} [tenant: ${tenantId}]`;
        console.log(`[KAFKA] ${kafkaLogMsg}`);
        emitTelemetryLog(io, '[KAFKA]', kafkaLogMsg);

        // Fan-out Socket.IO broadcasts
        if (type === 'order-created') {
          try {
            const redisKey = `branch:${tenantId}:orders`;
            await redisClient.incrBy(redisKey, 1);
            const redisLogMsg = `Branch counter updated: ${redisKey}`;
            console.log(`[REDIS] ${redisLogMsg}`);
            emitTelemetryLog(io, '[REDIS]', redisLogMsg);
          } catch (_) {}

          if (io) {
            io.to(`tenant:${tenantId}`).emit('order:new', payload);
            io.to(`order:${orderId}`).emit('order:status', payload);
            io.to('admin:global').emit('admin:order-stream', payload);

            const socketLogMsg = `Broadcast sent to tenant:${tenantId}, order:${orderId}, admin:global`;
            console.log(`[SOCKET] ${socketLogMsg}`);
            emitTelemetryLog(io, '[SOCKET]', socketLogMsg);
          }
        } else if (type === 'order-cancelled' || newStatus === 'CANCELLED') {
          if (io) {
            const cancelPayload = {
              orderId,
              tenantId,
              status: 'CANCELLED',
              cancellationReason: payload.cancellationReason,
              cancelledBy: payload.cancelledBy,
              timestamp: payload.timestamp || new Date().toISOString(),
            };

            io.to(`order:${orderId}`).emit('order:status', cancelPayload);
            io.to(`tenant:${tenantId}`).emit('order:cancelled', cancelPayload);
            io.to(`tenant:${tenantId}`).emit('order:status-update', cancelPayload);
            io.to('admin:global').emit('admin:order-stream', { ...cancelPayload, type: 'order-cancelled' });

            const auditMsg = `ORDER_CANCELLED | ${orderId} | By: ${payload.cancelledBy || 'UNKNOWN'} | Reason: "${payload.cancellationReason || 'None specified'}"`;
            console.log(`[AUDIT] ${auditMsg}`);
            emitTelemetryLog(io, '[AUDIT]', auditMsg);
          }
        } else if (type === 'order-updated') {
          if (io) {
            io.to(`order:${orderId}`).emit('order:status', {
              orderId,
              status: newStatus,
              timestamp: payload.timestamp,
            });

            io.to(`tenant:${tenantId}`).emit('order:status-update', payload);
            io.to('admin:global').emit('admin:order-stream', payload);

            const socketLogMsg = `Status update broadcast for order:${orderId}`;
            console.log(`[SOCKET] ${socketLogMsg}`);
            emitTelemetryLog(io, '[SOCKET]', socketLogMsg);
          }
        }
      },
    });

    console.log('[KAFKA] Primary telemetry pipeline active (listening on "order-events").');
  } catch (err) {
    console.warn(`[KAFKA WARN] Telemetry consumer offline - falling back to direct broadcast mode (${err.message})`);
  }

  // ── Backward-Compat Consumer ───────────────────────────────────────────────
  try {
    const compatKafka = createKafkaClient('flashbite-compat-consumer');
    const compatConsumer = compatKafka.consumer({
      groupId: 'flashbite-compat-group',
      heartbeatInterval: 3000,
      sessionTimeout: 30000,
    });

    await compatConsumer.connect();
    await compatConsumer.subscribe({
      topic: 'order_created',
      fromBeginning: false,
    });

    await compatConsumer.run({
      eachMessage: async ({ message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          const { orderId, tenantId } = payload;
          payload.type = payload.type || 'order-created';

          if (io) {
            io.to(`tenant:${tenantId}`).emit('order:new', payload);
            io.to(`order:${orderId}`).emit('order:status', payload);
            io.to('admin:global').emit('admin:order-stream', { ...payload, _source: 'compat' });
          }
        } catch (_) {}
      },
    });
  } catch (_) {
    // Non-fatal
  }
}

module.exports = { initTelemetryPipeline };
