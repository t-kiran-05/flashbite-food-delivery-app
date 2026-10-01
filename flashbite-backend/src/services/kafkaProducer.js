/**
 * @file src/services/kafkaProducer.js
 * @description KafkaJS-based producer service for FlashBite with non-blocking graceful fallback.
 *              Handles connection lifecycle, SSL/SASL configuration, topic creation,
 *              and safe message publishing.
 *
 * Resilience:
 *   - Non-blocking initialization.
 *   - If Kafka is unreachable or offline, publish calls log a warning and return cleanly
 *     without throwing unhandled promise rejections or halting order workflows.
 */

'use strict';

const { Kafka, CompressionTypes, logLevel } = require('kafkajs');
const fs = require('fs');
const path = require('path');

// ─── Environment Configuration ────────────────────────────────────────────────
const KAFKA_BROKERS_RAW = process.env.KAFKA_BROKERS || '';
const KAFKA_BROKERS = KAFKA_BROKERS_RAW
  ? KAFKA_BROKERS_RAW.split(',').map((b) => b.trim()).filter(Boolean)
  : ['localhost:9092'];

const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'flashbite-producer';
const KAFKA_USERNAME  = process.env.KAFKA_USERNAME || process.env.KAFKA_SASL_USERNAME || '';
const KAFKA_PASSWORD  = process.env.KAFKA_PASSWORD || process.env.KAFKA_SASL_PASSWORD || '';
const KAFKA_SASL_MECHANISM = (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256').toLowerCase();
const KAFKA_SSL       = process.env.KAFKA_SSL === 'true' || Boolean(KAFKA_USERNAME);
const KAFKA_CA_CERT_ENV = process.env.KAFKA_CA_CERT || '';

// ─── SSL Certificate Loading ──────────────────────────────────────────────────
const CA_CERT_PATH = path.resolve(__dirname, '../../certs/ca.pem');

function loadCACert() {
  if (KAFKA_CA_CERT_ENV) {
    if (KAFKA_CA_CERT_ENV.startsWith('-----BEGIN')) {
      return KAFKA_CA_CERT_ENV;
    }
    try {
      return fs.readFileSync(KAFKA_CA_CERT_ENV);
    } catch (e) {
      console.warn(`[KAFKA WARN] Could not read CA cert from KAFKA_CA_CERT path: ${e.message}`);
    }
  }

  if (fs.existsSync(CA_CERT_PATH)) {
    try {
      return fs.readFileSync(CA_CERT_PATH);
    } catch (_) {}
  }

  return null;
}

function buildSslConfig() {
  if (!KAFKA_SSL) return false;
  const ca = loadCACert();
  if (ca) {
    return { ca: [ca], rejectUnauthorized: true };
  }
  return true;
}

function buildSaslConfig() {
  if (!KAFKA_USERNAME || !KAFKA_PASSWORD) return null;

  const supported = ['plain', 'scram-sha-256', 'scram-sha-512'];
  const mechanism = supported.includes(KAFKA_SASL_MECHANISM)
    ? KAFKA_SASL_MECHANISM
    : 'scram-sha-256';

  return {
    mechanism,
    username: KAFKA_USERNAME,
    password: KAFKA_PASSWORD,
  };
}

// ─── Kafka Client & Producer ──────────────────────────────────────────────────
const sslConfig = buildSslConfig();
const saslConfig = buildSaslConfig();

const kafka = new Kafka({
  clientId: KAFKA_CLIENT_ID,
  brokers: KAFKA_BROKERS,
  ssl: sslConfig || undefined,
  sasl: saslConfig || undefined,
  logLevel: process.env.NODE_ENV === 'production' ? logLevel.NOTHING : logLevel.WARN,
  retry: {
    initialRetryTime: 300,
    retries: 3,
  },
});

const producer = kafka.producer({
  idempotent: false,
  allowAutoTopicCreation: true,
});

let isProducerConnected = false;
let isKafkaDisabled = false;
let hasLoggedOfflineWarning = false;

const MANAGED_TOPICS = [
  { topic: 'order-events',  numPartitions: 3, replicationFactor: 1 },
  { topic: 'order_created', numPartitions: 1, replicationFactor: 1 },
  { topic: 'metrics',       numPartitions: 1, replicationFactor: 1 },
];

/**
 * Connects the Kafka producer gracefully.
 * Non-blocking: If Kafka is offline, logs a warning and marks producer as disabled.
 *
 * @returns {Promise<boolean>} True if connected, false if running in fallback mode.
 */
async function connectProducer() {
  if (isProducerConnected) return true;

  try {
    await producer.connect();
    isProducerConnected = true;
    isKafkaDisabled = false;
    hasLoggedOfflineWarning = false;
    console.log('[KAFKA] Producer connected successfully ✓');

    // Attempt topic verification via admin client (non-fatal)
    try {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await admin.createTopics({
          waitForLeaders: false,
          topics: MANAGED_TOPICS,
        });
        console.log('[KAFKA] Verified topic provisioning ✓');
      } finally {
        await admin.disconnect();
      }
    } catch (_) {
      // Topic auto-creation or existing topics is fine
    }

    return true;
  } catch (err) {
    isProducerConnected = false;
    isKafkaDisabled = true;
    if (!hasLoggedOfflineWarning) {
      console.warn(`[KAFKA WARN] Cloud Kafka offline - falling back to internal event processing (${err.message})`);
      hasLoggedOfflineWarning = true;
    }
    return false;
  }
}

/**
 * Lazily attempts to connect if not already connected.
 */
async function ensureConnected() {
  if (isProducerConnected) return true;
  if (isKafkaDisabled) return false;
  return await connectProducer();
}

/**
 * Generic Kafka publish function.
 * Safely guarded: If Kafka is down or fails, logs a non-fatal warning and returns cleanly.
 *
 * @param {string} topic - Kafka topic name.
 * @param {object} payload - Message payload object.
 * @returns {Promise<void>}
 */
async function publishToKafka(topic, payload) {
  const connected = await ensureConnected();
  if (!connected) {
    // Kafka is currently offline/disabled - safe fallback
    return;
  }

  const message = JSON.stringify(payload);

  try {
    await producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [{ value: message }],
    });
    console.log(`[KAFKA] Published event to "${topic}":`, payload.type || '(event)');
  } catch (err) {
    if (!hasLoggedOfflineWarning) {
      console.warn(`[KAFKA WARN] Publish to "${topic}" failed (non-blocking fallback active):`, err.message);
      hasLoggedOfflineWarning = true;
    }
    // Mark as disconnected to trigger fallback on subsequent calls
    isProducerConnected = false;
  }
}

/**
 * Publishes order-created events.
 * @param {object} data - Order payload.
 * @returns {Promise<void>}
 */
async function publishOrderCreated(data) {
  await publishToKafka('order-events', data);
  try {
    await publishToKafka('order_created', data);
  } catch (_) {}
}

/**
 * Publishes telemetry/metrics event.
 * @param {number} cpu
 * @param {number} memory
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
async function publishMetrics(cpu, memory, tenantId) {
  const payload = {
    type: 'system-metrics',
    cpu,
    memory,
    tenantId: tenantId || 'global',
    timestamp: new Date().toISOString(),
  };

  await publishToKafka('metrics', payload);
}

/**
 * Graceful producer disconnect on shutdown.
 */
async function disconnectProducer() {
  if (!isProducerConnected) return;

  try {
    await producer.disconnect();
    isProducerConnected = false;
    console.log('[KAFKA] Producer disconnected gracefully.');
  } catch (err) {
    console.warn('[KAFKA WARN] Error disconnecting producer:', err.message);
  }
}

module.exports = {
  connectProducer,
  publishToKafka,
  publishOrderCreated,
  publishMetrics,
  disconnectProducer,
};