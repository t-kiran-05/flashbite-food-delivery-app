/**
 * @file src/models/Restaurant.js
 * @description Mongoose schema and model for FlashBite restaurant tenants.
 *
 * Each restaurant is a distinct tenant in the multi-tenant architecture.
 * The `tenantId` field acts as the tenant's unique slug (e.g. "flashbite-downtown")
 * and is the primary key used by every other collection for tenant isolation.
 */

'use strict';

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

const RestaurantSchema = new mongoose.Schema(
  {
    /**
     * Globally unique tenant identifier / slug for this restaurant.
     * Format convention: lowercase-kebab-case (e.g. "flashbite-downtown").
     *
     * This value:
     *  - Is set once at restaurant creation and should not change.
     *  - Is propagated to all orders and users belonging to this tenant.
     *  - Is used as the discriminator for tenant-scoped DB queries.
     */
    tenantId: {
      type:     String,
      required: [true, 'tenantId (slug) is required'],
      unique:   true,
      index:    true,
      trim:     true,
      lowercase: true,
    },

    /**
     * Human-readable display name of the restaurant shown in the UI.
     */
    name: {
      type:     String,
      required: [true, 'Restaurant name is required'],
      trim:     true,
    },

    /**
     * Physical or logical location of the restaurant
     * (e.g. "123 Main St, Springfield" or "Downtown Branch").
     */
    location: {
      type:     String,
      required: [true, 'Location is required'],
      trim:     true,
    },

    /**
     * Reference to the User who owns / administers this restaurant.
     * Populated with User documents when needed via `.populate('ownerId')`.
     */
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },

    /**
     * Soft-delete / visibility flag.
     * When false, the restaurant is hidden from customers but the data
     * is retained in the database for auditing purposes.
     */
    isActive: {
      type:    Boolean,
      default: true,
    },

    totalOrdersCount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    /**
     * Customer rating for this restaurant (out of 5.0).
     */
    rating: {
      type:    Number,
      default: 4.5,
      min:     1,
      max:     5,
    },
  },
  {
    /**
     * Automatically adds `createdAt` and `updatedAt` fields, managed by Mongoose.
     */
    timestamps: true,
  }
);

// ---------------------------------------------------------------------------
// Model export
// ---------------------------------------------------------------------------

/**
 * Mongoose model for the 'restaurants' collection.
 * Use this wherever restaurant documents need to be created, queried,
 * or updated (e.g. tenant provisioning, admin dashboards).
 */
module.exports = mongoose.model('Restaurant', RestaurantSchema);
