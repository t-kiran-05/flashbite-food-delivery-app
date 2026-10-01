/**
 * Restaurant Mongoose model.
 * Scoped to a tenant via tenantId (required, indexed for fast per-tenant queries).
 */
"use strict";
const mongoose = require("mongoose");

const MenuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    available: { type: Boolean, default: true },
    extras: { type: Array, default: [] },
  },
  { _id: false }
);

const RestaurantSchema = new mongoose.Schema(
  {
    /** tenantId scopes this restaurant to a specific operator / brand. */
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    address: { type: String, default: "" },
    menu: { type: [MenuItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Restaurant", RestaurantSchema);
