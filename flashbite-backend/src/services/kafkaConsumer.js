// // /**
// //  * Kafka Consumer service.
// //  * Consumes both "order_created" and "metrics" topics.
// //  *
// //  * order_created consumer:
// //  *   - Saves last 10 orders per tenant in Redis (list: orders:<tenantId>:last10)
// //  *   - Emits "newOrder" event to Socket.IO tenant room (tenant_<tenantId>)
// //  *
// //  * metrics consumer:
// //  *   - Aggregates ordersPerMin, totalOrders, avgPrepSeconds into Redis (hash: metrics:<tenantId>)
// //  *   - Emits "metrics_update" event to Socket.IO tenant room
// //  */
// // "use strict";
// // const { Kafka } = require("kafkajs");
// // const redisClient = require("./redisClient");

// // /**
// //  * Initialise and start both Kafka consumers.
// //  * @param {import("socket.io").Server} io - Socket.IO server instance
// //  */
// // async function initKafkaConsumers(io) {
// //   const kafka = new Kafka({
// //     clientId: `${process.env.KAFKA_CLIENT_ID || "food-delivery-merged"}-consumer`,
// //     brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
// //   });

// //   // -------------------------------------------------------------------------
// //   // Order consumer
// //   // -------------------------------------------------------------------------
// //   const orderConsumer = kafka.consumer({ groupId: "order-group-merged" });
// //   await orderConsumer.connect();
// //   await orderConsumer.subscribe({ topic: "order_created", fromBeginning: false });
// //   console.log("? Kafka order consumer connected");

// //   await orderConsumer.run({
// //     eachMessage: async ({ message }) => {
// //       try {
// //         const data = JSON.parse(message.value.toString());
// //         const tenantKey = `orders:${data.tenantId}:last10`;

// //         // Store last 10 orders in Redis list
// //         await redisClient.lPush(tenantKey, JSON.stringify(data));
// //         await redisClient.lTrim(tenantKey, 0, 9);

// //         // Emit to the tenant's Socket.IO room
// //         if (io) {
// //           io.to(`tenant_${data.tenantId}`).emit("newOrder", data);
// //         }
// //         console.log(`?? Order received [tenant: ${data.tenantId}] id=${data.orderId}`);
// //       } catch (err) {
// //         console.error("? Order consumer error:", err.message);
// //       }
// //     },
// //   });

// //   // -------------------------------------------------------------------------
// //   // Metrics consumer
// //   // -------------------------------------------------------------------------
// //   const metricsConsumer = kafka.consumer({ groupId: "metrics-group-merged" });
// //   await metricsConsumer.connect();
// //   await metricsConsumer.subscribe({ topic: "metrics", fromBeginning: false });
// //   console.log("? Kafka metrics consumer connected");

// //   await metricsConsumer.run({
// //     eachMessage: async ({ message }) => {
// //       try {
// //         const data = JSON.parse(message.value.toString());
// //         const tenantKey = `metrics:${data.tenantId}`;

// //         // Aggregate metrics in Redis
// //         const raw = await redisClient.get(tenantKey);
// //         const metrics = raw
// //           ? JSON.parse(raw)
// //           : { ordersPerMin: 0, totalOrders: 0, avgPrepSeconds: 0, lastCpu: 0, lastMemory: 0 };

// //         // If the event carries order data
// //         if (data.orderId) {
// //           metrics.ordersPerMin = (metrics.ordersPerMin || 0) + 1;
// //           metrics.totalOrders = (metrics.totalOrders || 0) + 1;
// //           if (data.prepTimeSeconds) {
// //             const prevTotal = metrics.avgPrepSeconds * (metrics.totalOrders - 1);
// //             metrics.avgPrepSeconds = (prevTotal + data.prepTimeSeconds) / metrics.totalOrders;
// //           }
// //         }

// //         // If the event carries system metrics (cpu/memory)
// //         if (data.cpu !== undefined) {
// //           metrics.lastCpu = data.cpu;
// //           metrics.lastMemory = data.memory;
// //           metrics.timestamp = data.timestamp;
// //         }

// //         await redisClient.set(tenantKey, JSON.stringify(metrics), { EX: 120 });

// //         if (io) {
// //           io.to(`tenant_${data.tenantId}`).emit("metrics_update", metrics);
// //         }
// //         console.log(`?? Metrics updated [tenant: ${data.tenantId}]`);
// //       } catch (err) {
// //         console.error("? Metrics consumer error:", err.message);
// //       }
// //     },
// //   });
// // }

// // module.exports = { initKafkaConsumers };

// /**
//  * Kafka Consumer service.
//  * Consumes both "order_created" and "metrics" topics.
//  *
//  * order_created consumer:
//  *   - Saves last 10 orders per tenant in Redis (list: orders:<tenantId>:last10)
//  *   - Emits "newOrder" event to Socket.IO tenant room (tenant_<tenantId>)
//  *
//  * metrics consumer:
//  *   - Aggregates ordersPerMin, totalOrders, avgPrepSeconds into Redis (hash: metrics:<tenantId>)
//  *   - Emits "metrics_update" event to Socket.IO tenant room
//  */
// "use strict";
// const { Kafka } = require("kafkajs");
// const fs = require("fs");
// const path = require("path");
// const redisClient = require("./redisClient");

// // Resolve CA Certificate path
// const caCertPath = path.join(__dirname, "../../certs/ca.pem");

// // Read CA cert file if present, or fallback to environment variable string
// let caCert;
// if (fs.existsSync(caCertPath)) {
//   caCert = fs.readFileSync(caCertPath, "utf-8");
// } else if (process.env.KAFKA_CA_CERT) {
//   caCert = process.env.KAFKA_CA_CERT.replace(/\\n/g, "\n");
// }

// // Dynamic SSL configuration for Cloud Kafka
// const sslConfig = caCert
//   ? { rejectUnauthorized: true, ca: [caCert] }
//   : process.env.KAFKA_SSL === "true";

// // Dynamic SASL configuration for Cloud Kafka
// const saslConfig =
//   process.env.KAFKA_USERNAME && process.env.KAFKA_PASSWORD
//     ? {
//         mechanism: process.env.KAFKA_SASL_MECHANISM || "scram-sha-256",
//         username: process.env.KAFKA_USERNAME,
//         password: process.env.KAFKA_PASSWORD,
//       }
//     : undefined;

// /**
//  * Initialise and start both Kafka consumers.
//  * @param {import("socket.io").Server} io - Socket.IO server instance
//  */
// async function initKafkaConsumers(io) {
//   const kafka = new Kafka({
//     clientId: `${process.env.KAFKA_CLIENT_ID || "food-delivery-merged"}-consumer`,
//     brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
//     ssl: sslConfig,
//     sasl: saslConfig,
//   });

//   // -------------------------------------------------------------------------
//   // Order consumer
//   // -------------------------------------------------------------------------
//   const orderConsumer = kafka.consumer({ groupId: "order-group-merged" });
//   await orderConsumer.connect();
//   await orderConsumer.subscribe({ topic: "order_created", fromBeginning: false });
//   console.log("⚡ Kafka order consumer connected");

//   await orderConsumer.run({
//     eachMessage: async ({ message }) => {
//       try {
//         const data = JSON.parse(message.value.toString());
//         const tenantKey = `orders:${data.tenantId}:last10`;

//         // Store last 10 orders in Redis list
//         await redisClient.lPush(tenantKey, JSON.stringify(data));
//         await redisClient.lTrim(tenantKey, 0, 9);

//         // Emit to the tenant's Socket.IO room
//         if (io) {
//           io.to(`tenant_${data.tenantId}`).emit("newOrder", data);
//         }
//         console.log(`📦 Order received [tenant: ${data.tenantId}] id=${data.orderId}`);
//       } catch (err) {
//         console.error("❌ Order consumer error:", err.message);
//       }
//     },
//   });

//   // -------------------------------------------------------------------------
//   // Metrics consumer
//   // -------------------------------------------------------------------------
//   const metricsConsumer = kafka.consumer({ groupId: "metrics-group-merged" });
//   await metricsConsumer.connect();
//   await metricsConsumer.subscribe({ topic: "metrics", fromBeginning: false });
//   console.log("⚡ Kafka metrics consumer connected");

//   await metricsConsumer.run({
//     eachMessage: async ({ message }) => {
//       try {
//         const data = JSON.parse(message.value.toString());
//         const tenantKey = `metrics:${data.tenantId}`;

//         // Aggregate metrics in Redis
//         const raw = await redisClient.get(tenantKey);
//         const metrics = raw
//           ? JSON.parse(raw)
//           : { ordersPerMin: 0, totalOrders: 0, avgPrepSeconds: 0, lastCpu: 0, lastMemory: 0 };

//         // If the event carries order data
//         if (data.orderId) {
//           metrics.ordersPerMin = (metrics.ordersPerMin || 0) + 1;
//           metrics.totalOrders = (metrics.totalOrders || 0) + 1;
//           if (data.prepTimeSeconds) {
//             const prevTotal = metrics.avgPrepSeconds * (metrics.totalOrders - 1);
//             metrics.avgPrepSeconds = (prevTotal + data.prepTimeSeconds) / metrics.totalOrders;
//           }
//         }

//         // If the event carries system metrics (cpu/memory)
//         if (data.cpu !== undefined) {
//           metrics.lastCpu = data.cpu;
//           metrics.lastMemory = data.memory;
//           metrics.timestamp = data.timestamp;
//         }

//         await redisClient.set(tenantKey, JSON.stringify(metrics), { EX: 120 });

//         if (io) {
//           io.to(`tenant_${data.tenantId}`).emit("metrics_update", metrics);
//         }
//         console.log(`📊 Metrics updated [tenant: ${data.tenantId}]`);
//       } catch (err) {
//         console.error("❌ Metrics consumer error:", err.message);
//       }
//     },
//   });
// }

// module.exports = { initKafkaConsumers };

"use strict";
const { Kafka } = require("kafkajs");
const fs = require("fs");
const path = require("path");
const redisClient = require("./redisClient");

// Resolve CA Certificate path
const caCertPath = path.join(__dirname, "../../certs/ca.pem");

let caCert;
if (fs.existsSync(caCertPath)) {
  caCert = fs.readFileSync(caCertPath, "utf-8");
} else if (process.env.KAFKA_CA_CERT) {
  caCert = process.env.KAFKA_CA_CERT.replace(/\\n/g, "\n");
}

const sslConfig = caCert
  ? { rejectUnauthorized: true, ca: [caCert] }
  : process.env.KAFKA_SSL === "true";

const saslConfig =
  process.env.KAFKA_USERNAME && process.env.KAFKA_PASSWORD
    ? {
        mechanism: process.env.KAFKA_SASL_MECHANISM || "scram-sha-256",
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD,
      }
    : undefined;

/**
 * Normalizes room name to prevent double prefixes (e.g., tenant_tenant_001 -> tenant_001)
 */
function getTenantRoom(tenantId) {
  if (!tenantId) return "tenant_default";
  const rawId = tenantId.replace(/^tenant_/, "");
  return `tenant_${rawId}`;
}

async function initKafkaConsumers(io) {
  const kafka = new Kafka({
    clientId: `${process.env.KAFKA_CLIENT_ID || "food-delivery-merged"}-consumer`,
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || "localhost:9092").split(","),
    ssl: sslConfig,
    sasl: saslConfig,
  });

  // -------------------------------------------------------------------------
  // Order Consumer
  // -------------------------------------------------------------------------
  const orderConsumer = kafka.consumer({ groupId: "order-group-merged" });
  await orderConsumer.connect();
  await orderConsumer.subscribe({ topic: "order_created", fromBeginning: false });
  console.log("⚡ Kafka order consumer connected");

  await orderConsumer.run({
    eachMessage: async ({ message }) => {
      try {
        const data = JSON.parse(message.value.toString());
        const orderId = data.orderId || data._id;
        const normalizedRoom = getTenantRoom(data.tenantId);
        const rawTenant = data.tenantId || "default";
        const tenantKey = `orders:${rawTenant}:last10`;

        // Store last 10 orders in Redis list
        if (redisClient && redisClient.isOpen) {
          await redisClient.lPush(tenantKey, JSON.stringify(data));
          await redisClient.lTrim(tenantKey, 0, 9);
        }

        // Emit to both normalized room ("tenant_001") and raw tenant ID ("001") for fail-safe socket delivery
        if (io) {
          io.to(normalizedRoom).to(rawTenant).emit("newOrder", data);
        }
        console.log(`📦 Order received [tenant: ${data.tenantId}] id=${orderId}`);
      } catch (err) {
        console.error("❌ Order consumer error:", err.message);
      }
    },
  });

  // -------------------------------------------------------------------------
  // Metrics Consumer
  // -------------------------------------------------------------------------
  const metricsConsumer = kafka.consumer({ groupId: "metrics-group-merged" });
  await metricsConsumer.connect();
  await metricsConsumer.subscribe({ topic: "metrics", fromBeginning: false });
  console.log("⚡ Kafka metrics consumer connected");

  await metricsConsumer.run({
    eachMessage: async ({ message }) => {
      try {
        const data = JSON.parse(message.value.toString());
        const orderId = data.orderId || data._id;
        const normalizedRoom = getTenantRoom(data.tenantId);
        const rawTenant = data.tenantId || "default";
        const tenantKey = `metrics:${rawTenant}`;

        let metrics = { ordersPerMin: 0, totalOrders: 0, avgPrepSeconds: 0, lastCpu: 0, lastMemory: 0 };

        if (redisClient && redisClient.isOpen) {
          const raw = await redisClient.get(tenantKey);
          if (raw) metrics = JSON.parse(raw);
        }

        // Handle order metrics update
        if (orderId) {
          metrics.ordersPerMin = (metrics.ordersPerMin || 0) + 1;
          metrics.totalOrders = (metrics.totalOrders || 0) + 1;
          if (data.prepTimeSeconds !== undefined) {
            const prevTotal = metrics.avgPrepSeconds * (metrics.totalOrders - 1);
            metrics.avgPrepSeconds = (prevTotal + data.prepTimeSeconds) / metrics.totalOrders;
          }
        }

        // Handle system metrics update
        if (data.cpu !== undefined) {
          metrics.lastCpu = data.cpu;
          metrics.lastMemory = data.memory;
          metrics.timestamp = data.timestamp;
        }

        if (redisClient && redisClient.isOpen) {
          await redisClient.set(tenantKey, JSON.stringify(metrics), { EX: 120 });
        }

        if (io) {
          io.to(normalizedRoom).to(rawTenant).emit("metrics_update", metrics);
        }
        console.log(`📊 Metrics updated [tenant: ${data.tenantId}]`);
      } catch (err) {
        console.error("❌ Metrics consumer error:", err.message);
      }
    },
  });
}

module.exports = { initKafkaConsumers, getTenantRoom };