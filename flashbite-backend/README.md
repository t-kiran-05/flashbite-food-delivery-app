# FlashBite Backend API & Telemetry Engine

The core backend microservice for FlashBite, providing REST APIs, Socket.IO multi-room gateways, Apache Kafka event streaming, Upstash/Local Redis pub/sub metrics, and MongoDB multi-tenant persistence.

---

## Architecture & Tech Stack
- **Runtime**: Node.js (v18+ / v20+) & Express 5.x
- **Database**: MongoDB (Mongoose ODM)
- **Event Streaming**: Apache Kafka (KafkaJS client)
- **Caching & Live Counters**: Redis (ioredis / node-redis v4)
- **Real-Time Push**: Socket.IO (JWT Handshake Authentication)

---

## Getting Started

### 1. Cloud Setup (Default)
1. Ensure your `.env` contains your MongoDB Atlas, Upstash Redis, and Aiven Kafka credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Seed the database with Super Admin and demo restaurant items:
   ```bash
   npm run seed
   ```
4. Start development server:
   ```bash
   npm run dev
   ```

### 2. Local Docker Setup
Run the complete backend stack with Kafka KRaft, Redis 7, MongoDB 6.0:
```bash
docker compose up --build
```

---

## Scripts Reference

- `npm start`: Starts production HTTP & WebSocket server (`node src/server.js`)
- `npm run dev`: Starts nodemon dev server with hot reload
- `npm run seed`: Seeds admin account and demo restaurant menu
- `npm run seed:admin`: Seeds `admin@flashbite.com` (`AdminSecret123!`)
- `npm run seed:menu`: Seeds `fb-demo0001` with 12 dishes
- `npm run clear:orders`: Clears test orders and resets branch counters

---

## Deployment (Render)
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Port**: Bound dynamically via `process.env.PORT`
