/**
 * @file src/app.js
 * @description Express application factory for FlashBite multi-tenant ordering system.
 *
 *              This module creates and configures the Express app — middleware,
 *              routes, static file serving, and error handlers — but does NOT
 *              start listening.  The http.Server is created in server.js so that
 *              Socket.IO can share the same port.
 *
 *              Middleware stack (in order):
 *               1. helmet  — security headers (with custom CSP)
 *               2. cors    — cross-origin resource sharing
 *               3. express.json / express.urlencoded — body parsing
 *               4. static  — serves ./public directory
 *               5. API routes
 *               6. HTML page routes
 *               7. 404 handler for /api/* routes
 *               8. Global error handler
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');

// ─── Route Modules ────────────────────────────────────────────────────────────
const authRoutes   = require('./routes/auth');
const orderRoutes  = require('./routes/orders');
const menuRoutes   = require('./routes/menu');
const searchRoutes = require('./routes/searchRoutes');


// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();

// ═══════════════════════════════════════════════════════════════════════════════
// Security: Helmet
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Helmet sets sensible HTTP security headers (X-Frame-Options, HSTS,
 * X-Content-Type-Options, etc.).
 *
 * Custom Content-Security-Policy:
 *  - Allows scripts from the jsdelivr CDN (used by the Socket.IO client bundle)
 *  - Allows scripts from cdnjs.cloudflare.com (common UI libraries)
 *  - 'self' is always included
 *
 * Adjust the policy to match your actual CDN usage in production.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',        // Socket.IO client CDN
          'https://cdnjs.cloudflare.com',    // Common JS libs
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",                 // Inline styles used by some UI kits
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
        ],
        connectSrc: [
          "'self'",
          'ws:',   // WebSocket connections (non-TLS dev environment)
          'wss:',  // WebSocket connections (TLS production)
        ],
        imgSrc:  ["'self'", 'data:'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      },
    },
    // Allow inline scripts in development — must be removed for production
    crossOriginEmbedderPolicy: false,
  })
);

// ═══════════════════════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Dynamic CORS configuration. Supports CLIENT_URL / FRONTEND_ORIGIN comma-separated
 * domains (e.g. Vercel deployment URLs, localhost) or wildcard fallback.
 */
const rawOrigins = process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || '*';
const allowedOrigins = rawOrigins === '*'
  ? '*'
  : rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins === '*' || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app') || origin.includes('localhost')) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ═══════════════════════════════════════════════════════════════════════════════
// Body Parsing
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Parse incoming JSON request bodies.
 * 10mb limit covers large item arrays; adjust if needed.
 */
app.use(express.json({ limit: '10mb' }));

/**
 * Parse URL-encoded form bodies (used by some HTML forms).
 * `extended: true` allows rich objects and arrays.
 */
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══════════════════════════════════════════════════════════════════════════════
// Static Files
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Serve everything in ./public as static assets.
 * This covers CSS, client-side JS, images, and the Socket.IO client.
 * HTML pages are served explicitly via routes below (not as static files)
 * so that they respond to extension-less URLs (/login, /customer, etc.).
 */
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ═══════════════════════════════════════════════════════════════════════════════
// Root & Health Check Endpoints
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route GET /
 * @desc  Root status endpoint for API gateway.
 * @access Public
 */
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'FlashBite API Gateway',
    version: '2.0.0',
    status: 'online',
    docs: '/api/health',
  });
});

/**
 * Health check handler used by load balancers, Docker health checks,
 * and monitoring systems (Render, Uptime Robot, etc.).
 */
const healthHandler = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'FlashBite API',
    version: '2.0.0',
  });
};

/** @route GET /health */
app.get('/health', healthHandler);

/** @route GET /api/health */
app.get('/api/health', healthHandler);


// ═══════════════════════════════════════════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Authentication routes:  POST /api/auth/register, POST /api/auth/login
 */
app.use('/api/auth', authRoutes);

/**
 * Order & admin routes:
 *  POST  /api/orders
 *  PATCH /api/orders/:orderId/status
 *  GET   /api/admin/branches
 */
app.use('/api', orderRoutes);

/**
 * Menu routes (public GET + authenticated management):
 *  GET    /api/menu/:tenantId          — public menu for customers
 *  GET    /api/menu/manage             — restaurant admin: full menu
 *  POST   /api/menu/item               — add item
 *  PATCH  /api/menu/item/:itemId       — update item
 *  DELETE /api/menu/item/:itemId       — remove item
 *  POST   /api/menu/toggle/:itemId     — toggle availability
 */
app.use('/api/menu', menuRoutes);

/**
 * AI Craving Search routes:
 *  POST   /api/search/craving          — natural language craving search
 */
app.use('/api/search', searchRoutes);


// ═══════════════════════════════════════════════════════════════════════════════
// HTML Page Routes (extension-less)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Serve individual HTML pages for each role-based view.
 * Using sendFile with an absolute path from PUBLIC_DIR.
 * These routes must come AFTER API routes to avoid shadowing them.
 */

/** @route GET /login — Login / landing page */
app.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

/** @route GET /customer — Customer order portal */
app.get('/customer', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'customer.html'));
});

/** @route GET /restaurant — Restaurant staff / admin dashboard */
app.get('/restaurant', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'restaurant.html'));
});

/** @route GET /admin — Super-admin platform dashboard */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 404 Handler — API routes only
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Catches any /api/... request that didn't match a defined route.
 * Returns JSON so API consumers get a machine-readable error.
 *
 * Note: Express 5 / path-to-regexp v8 requires named captures for wildcards,
 * so '/api/*' triggers a parse error. We use a plain app.use() + path check.
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/api') {
    return res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Global Error Handler
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Express error-handling middleware must have exactly 4 parameters (err, req, res, next).
 * Catches any error passed via next(err) or thrown inside async route handlers
 * (if wrapped with a try/catch that calls next(err)).
 *
 * In production, we do NOT expose stack traces in the response body.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV !== 'production';

  console.error('[ERROR]', err.message, isDev ? err.stack : '');

  res.status(statusCode).json({
    error: err.message || 'An unexpected error occurred.',
    // Include stack trace in development for easier debugging
    ...(isDev && { stack: err.stack }),
  });
});

module.exports = app;