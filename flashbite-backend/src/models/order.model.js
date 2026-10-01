/**
 * Order Mongoose model.
 * tenantId scopes each order to a specific tenant.
 * Kafka consumers update status in real-time; Redis caches the last 10 per tenant.
 */
"use strict";
const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, default: 1 },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    /** tenantId scopes this order to a specific tenant. */
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true },
    restaurantId: { type: String, default: null },
    items: { type: [OrderItemSchema], default: [] },
    total: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["placed", "confirmed", "preparing", "ready", "delivered", "cancelled"],
      default: "placed",
    },
    prepTimeSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
