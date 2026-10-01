/**
 * @file src/models/MenuItem.js
 * @description Mongoose model for individual menu items.
 *              Allows direct querying and populating of restaurant details.
 */
'use strict';

const mongoose = require('mongoose');

const MenuItemSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true, index: true },
    price:        { type: Number, required: true, min: 0, index: true },
    category:     { type: String, default: 'main', trim: true, index: true },
    description:  { type: String, default: '', trim: true },
    emoji:        { type: String, default: '🍽️' },
    available:    { type: Boolean, default: true, index: true },
    tags:         { type: [String], default: [], index: true },
    isSpicy:      { type: Boolean, default: false, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    tenantId:     { type: String, default: null, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MenuItem || mongoose.model('MenuItem', MenuItemSchema);
