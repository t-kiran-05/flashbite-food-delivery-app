/**
 * @file src/models/menu.model.js  (enhanced)
 * @description Menu Mongoose model — now includes description and emoji fields
 *              so the customer-facing menu card can render rich item info.
 */
'use strict';
const mongoose = require('mongoose');

const MenuItemSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    price:       { type: Number, required: true, min: 0 },
    category:    { type: String, default: 'main', trim: true },
    description: { type: String, default: '', trim: true },
    emoji:       { type: String, default: '🍽️' },
    available:   { type: Boolean, default: true },
    tags:        { type: [String], default: [] },
    isSpicy:     { type: Boolean, default: false },
  },
  { _id: true }
);

const MenuSchema = new mongoose.Schema(
  {
    /** tenantId scopes this menu to a specific restaurant. */
    tenantId:     { type: String, required: true, unique: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    items:        { type: [MenuItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Menu', MenuSchema);
