# ⚡ FlashBite — Multi-Tenant Enterprise Restaurant Operations & Ordering Platform

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=flat&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-lightgrey?style=flat&logo=express)](https://expressjs.com/)
[![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-Event_Streaming-orange?style=flat&logo=apachekafka)](https://kafka.apache.org/)
[![Redis](https://img.shields.io/badge/Redis-Pub%2FSub_%26_Cache-red?style=flat&logo=redis)](https://redis.io/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas_%26_Local-brightgreen?style=flat&logo=mongodb)](https://www.mongodb.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--Time_WebSockets-black?style=flat&logo=socket.io)](https://socket.io/)

FlashBite is a distributed, event-driven, multi-tenant restaurant ordering and real-time kitchen operations system. Built with an enterprise architecture, FlashBite decouples high-throughput order ingestion from kitchen processing using Apache Kafka event streaming, Redis caching & metrics counters, MongoDB document persistence, and Socket.IO multi-room WebSocket synchronization.

---

## 🏛️ System Architecture Overview

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                           FLASHBITE FRONTEND                           │
 │                 (Next.js 15 App Router · Tailwind CSS)                 │
 └──────────────────────┬──────────────────────────▲──────────────────────┘
                        │ HTTP REST                │ WebSocket (JWT Auth)
                        ▼                          │
 ┌─────────────────────────────────────────────────┴──────────────────────┐
 │                            EXPRESS BACKEND                             │
 │           Auth (JWT) · Tenant Isolation · Order Ingestion API          │
 └──────────────┬──────────────────────────┬──────────────────────────────┘
                │                          │
                ▼                          ▼
      ┌──────────────────┐       ┌──────────────────┐
      │  MongoDB Atlas   │       │   Apache Kafka   │
      │  Persistent DB   │       │  (Topic: order-  │
      │  Orders / Menus  │       │      events)     │
      └──────────────────┘       └─────────┬────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │  Telemetry Pipeline  │
                                │  (Consumer Service)  │
                                └──────────┬───────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
             ┌─────────────────────┐               ┌─────────────────────┐
             │     Upstash /       │               │      Socket.IO      │
             │    Local Redis      │               │   Multi-Room Hub    │
             │   Metrics & Cache   │               │ tenant:* / admin:*  │
             └─────────────────────┘               └─────────────────────┘
```

### Architectural Highlights
1. **Multi-Tenant Isolation**: Each restaurant operates under an isolated `tenantId`. Branch staff only access their restaurant's queue, customers only view their branch's menu, and Super Admins inspect global operations.
2. **Event-Driven Decoupling**: Order placements are committed to MongoDB and immediately streamed to the Kafka `order-events` topic.
3. **Telemetry & Live Fan-Out**: The consumer pipeline reads Kafka events, atomically updates Redis live counters (`branch:<tenantId>:orders`), and fans out updates to dedicated Socket.IO rooms (`tenant:<tenantId>`, `order:<orderId>`, `admin:global`).
4. **Resilient Non-Blocking Startup**: If Cloud Kafka or Redis is temporarily unreachable or offline during startup, the backend automatically transitions to non-blocking fallback mode without crashing.

---

## 📁 Repository Structure

```
project-delivery/
├── flashbite-frontend/         # Next.js 15 + TypeScript Frontend
│   ├── app/
│   │   ├── admin/page.tsx      # Super Admin platform dashboard & telemetry terminal
│   │   ├── customer/page.tsx   # Customer menu catalog, branch selector & live order tracker
│   │   ├── login/page.tsx      # Split-screen role-based authentication
│   │   └── restaurant/page.tsx # Kitchen queue & menu management dashboard
│   ├── components/             # Reusable UI components
│   └── lib/                    # API client, Socket singleton, and Auth helpers
│
├── flashbite-backend/             # Express.js Microservices Backend
│   ├── src/
│   │   ├── config/             # Database & infrastructure configuration
│   │   ├── middleware/         # JWT authentication, role guards & tenant scoping
│   │   ├── models/             # Mongoose schemas (User, Restaurant, Order, Menu)
│   │   ├── routes/             # REST APIs (/api/auth, /api/orders, /api/menu, /api/branches)
│   │   ├── scripts/            # Seed & cleanup utilities (seedAdmin, seedMenu, clearOrders)
│   │   ├── services/           # Kafka producer, consumer telemetry pipeline & Redis client
│   │   ├── app.js              # Express app with dynamic CORS
│   │   └── server.js           # HTTP + Socket.IO server entrypoint
│   ├── Dockerfile              # Multi-stage production container
│   ├── docker-compose.yml      # Local development cluster
│   └── .env.example            # Environment configuration template
│
└── docker-compose.yml          # Root-level Docker Compose file
```

---

## 🚀 Getting Started

You can run FlashBite using either **Option 1 (Cloud Services)** or **Option 2 (Local Docker)**.

### Option 1: Cloud Services (Aiven Kafka + Upstash Redis + MongoDB Atlas) — Default

#### 1. Backend Setup
```bash
cd flashbite-backend
npm install

# Copy environment template
cp .env.example .env
```

Configure your `.env` with your cloud credentials:
```env
PORT=5000
NODE_ENV=development
JWT_SECRET=your_super_secret_jwt_key
CLIENT_URL=http://localhost:3000

# MongoDB Atlas
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/flashbite?retryWrites=true&w=majority

# Upstash Redis (TLS)
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Aiven Kafka (SSL/SASL)
KAFKA_BROKERS=your-aiven-host.aivencloud.com:24128
KAFKA_SSL=true
KAFKA_SASL_USERNAME=avnadmin
KAFKA_SASL_PASSWORD=your_aiven_password
KAFKA_SASL_MECHANISM=scram-sha-256

GEMINI_API_KEY=
```

Seed initial database demo data:
```bash
# Seed Super Admin and Demo Restaurant Menu
npm run seed
```

Start the backend:
```bash
npm run dev
# Backend runs at http://localhost:4000/health
```

#### 2. Frontend Setup
In a new terminal:
```bash
cd flashbite-frontend
npm install
npm run dev
# Frontend runs at http://localhost:3000
```

---

### Option 2: Full Local Stack with Docker Compose (No Cloud Accounts Needed)

Reviewers and developers can spin up the entire multi-service stack (KRaft Kafka, Redis 7, MongoDB 6.0, and Express API) with one command:

```bash
# From project root:
docker compose up --build
```

#### Services Spawned:
- **Express API Backend**: ` http://localhost:4000/health`
- **MongoDB**: `localhost:27017`
- **Redis**: `localhost:6379`
- **Apache Kafka (KRaft Mode)**: `localhost:9092`

Run the Next.js frontend alongside Docker:
```bash
cd flashbite-frontend
npm install
npm run dev
```

---

## 🔑 Default Seed Credentials

After running `npm run seed`:

| Role | Email | Password | Branch ID |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@flashbite.com` | `AdminSecret123!` | Global (`admin:global`) |
| **Kitchen Admin** | `kitchen@flashbite.com` | `Kitchen@Demo99` | `fb-demo0001` |
| **Customer** | Self-register at `/login` | Min 8 characters | Select `fb-demo0001` |

---

---

## 📄 License
ISC © FlashBite Engineering Team.
