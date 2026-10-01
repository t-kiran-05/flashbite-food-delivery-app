/**
 * @file src/config/db.js
 * @description MongoDB connection helper for the FlashBite backend.
 *
 * Provides a single `connectDB()` async function that:
 *  1. Reads the connection string from the MONGO_URI environment variable.
 *  2. Establishes a Mongoose connection with sensible default options.
 *  3. Attaches event listeners that log important connection lifecycle events.
 *
 * Call `connectDB()` once during application bootstrap (e.g. in `src/server.js`)
 * before starting the HTTP server.
 */

'use strict';

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

/**
 * Mongoose fires `connected` when a connection to MongoDB is established.
 * Log the host for quick sanity-checking in startup logs.
 */
mongoose.connection.on('connected', () => {
  console.log(`[MongoDB] Connected to: ${mongoose.connection.host}`);
});

/**
 * Mongoose fires `error` when there is a connection-level error after the
 * initial connection succeeds (e.g. network interruption, auth failure).
 */
mongoose.connection.on('error', (err) => {
  console.error(`[MongoDB] Connection error: ${err.message}`);
});

/**
 * Mongoose fires `disconnected` when the driver loses contact with MongoDB.
 * In production this would trigger an alert; here we log it clearly so
 * operators can detect unexpected disconnections in the log stream.
 */
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected from database.');
});

/**
 * Gracefully close the Mongoose connection when the Node.js process exits.
 * This prevents file-descriptor leaks and ensures in-flight writes are flushed.
 */
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('[MongoDB] Connection closed on app termination.');
  } catch (closeErr) {
    console.error('[MongoDB] Error closing connection on SIGINT:', closeErr.message);
  } finally {
    process.exit(0);
  }
});

// ---------------------------------------------------------------------------
// connectDB
// ---------------------------------------------------------------------------

/**
 * connectDB
 * ---------
 * Establishes a Mongoose connection to MongoDB using the URI defined in the
 * MONGO_URI environment variable.
 *
 * Mongoose 6+ removed most legacy options (useNewUrlParser, useUnifiedTopology,
 * etc.) so they are omitted here. The function is idempotent: calling it when
 * a connection is already open is a no-op because Mongoose manages a single
 * default connection internally.
 *
 * @throws {Error} If MONGO_URI is not set or the connection attempt fails.
 * @returns {Promise<void>}
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;

  // Guard against a missing environment variable early so the error message
  // is clear rather than a cryptic Mongoose validation error.
  if (!uri) {
    throw new Error(
      '[MongoDB] MONGO_URI environment variable is not set. ' +
      'Add it to your .env file before starting the server.'
    );
  }

  try {
    // mongoose.connect() returns the Mongoose instance on success.
    // The 'connected' event listener above will log the successful connection.
    await mongoose.connect(uri);
  } catch (err) {
    // Log and re-throw so the caller (server bootstrap) can decide whether to
    // exit the process or attempt a retry.
    console.error(`[MongoDB] Initial connection failed: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = connectDB;