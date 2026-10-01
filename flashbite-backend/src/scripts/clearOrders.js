/**
 * @file src/scripts/clearOrders.js
 * @description Deletes ALL orders from MongoDB and resets every restaurant's
 *              totalOrdersCount to 0. Use this to wipe test data cleanly.
 *
 * Run with:  node src/scripts/clearOrders.js
 */
'use strict';

require('dotenv').config();
const mongoose   = require('mongoose');
const Order      = require('../models/Order');
const Restaurant = require('../models/Restaurant');

async function clearOrders() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('[ClearOrders] MONGO_URI not set.'); process.exit(1); }

  console.log('[ClearOrders] Connecting to MongoDB…');
  await mongoose.connect(mongoUri);
  console.log(`[ClearOrders] Connected: ${mongoose.connection.host}`);

  try {
    const { deletedCount } = await Order.deleteMany({});
    console.log(`[ClearOrders] ✅ Deleted ${deletedCount} orders.`);

    const { modifiedCount } = await Restaurant.updateMany({}, { $set: { totalOrdersCount: 0 } });
    console.log(`[ClearOrders] ✅ Reset totalOrdersCount on ${modifiedCount} restaurants.`);

    console.log('\n[ClearOrders] Database is clean. All order data removed.');
  } catch (err) {
    console.error('[ClearOrders] Error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('[ClearOrders] Disconnected. Done.');
  }
}

if (require.main === module) clearOrders();
