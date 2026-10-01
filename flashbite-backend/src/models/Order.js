/**
 * @file src/models/Order.js
 * @description Mongoose schema and model for FlashBite customer orders.
 *
 * Orders are tenant-scoped — every document carries a `tenantId` that maps
 * back to a Restaurant document. The `orderId` is a UUID generated at order
 * creation time (by the service layer), giving each order a globally unique,
 * human-shareable reference that is independent of the MongoDB ObjectId.
 *
 * Status lifecycle:
 *   ORDER_RECEIVED → PREPARING → OUT_FOR_DELIVERY → DELIVERED
 */

'use strict';

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schema: order line item
// ---------------------------------------------------------------------------

/**
 * LineItemSchema
 * Represents a single menu item within an order.
 * `_id: false` prevents Mongoose from generating a sub-document ID for each
 * item, keeping the embedded array lean and JSON responses clean.
 */
const LineItemSchema = new mongoose.Schema(
  {
    /**
     * External identifier for the menu item (e.g. a UUID from the menu service).
     * Stored as a string to decouple from the MongoDB ObjectId format.
     */
    itemId: {
      type:     String,
      required: [true, 'itemId is required for each order line'],
    },

    /**
     * Human-readable name of the item at the time the order was placed.
     * Denormalized here so that historical orders remain accurate even if
     * the menu item name changes later.
     */
    name: {
      type:     String,
      required: [true, 'Item name is required'],
    },

    /**
     * Unit price of the item at the time the order was placed (in the
     * platform's base currency). Denormalized for the same reason as `name`.
     */
    price: {
      type:     Number,
      required: [true, 'Item price is required'],
      min:      [0, 'Price cannot be negative'],
    },

    /**
     * Number of units of this item ordered.
     * Must be at least 1.
     */
    quantity: {
      type:     Number,
      required: [true, 'Quantity is required'],
      min:      [1, 'Quantity must be at least 1'],
    },
  },
  { _id: false } // suppress sub-document _id generation
);

// ---------------------------------------------------------------------------
// Main schema definition
// ---------------------------------------------------------------------------

const OrderSchema = new mongoose.Schema(
  {
    /**
     * UUID v4 string assigned by the service layer before saving.
     * Used as a human-friendly order reference number in emails,
     * receipts, and support tickets.
     * Indexed for fast single-order lookups by orderId.
     */
    orderId: {
      type:     String,
      required: [true, 'orderId is required'],
      unique:   true,
      index:    true,
    },

    /**
     * Tenant slug linking this order to a specific restaurant.
     * Indexed so that restaurant-scoped order queries remain performant
     * even as the collection grows large.
     */
    tenantId: {
      type:     String,
      required: [true, 'tenantId is required'],
      index:    true,
    },

    /**
     * Reference to the User (CUSTOMER role) who placed the order.
     * Allows population of customer details without duplicating them here.
     */
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },

    /**
     * Ordered line items (embedded array).
     * Using embedded documents (rather than references) keeps order history
     * self-contained and prevents data inconsistency if menu items are later
     * edited or deleted.
     */
    items: {
      type:    [LineItemSchema],
      default: [],
    },

    /**
     * Pre-calculated grand total for the order in the platform's base currency.
     * Stored explicitly so that pricing changes do not retroactively alter
     * historical order totals.
     */
    totalAmount: {
      type:     Number,
      required: [true, 'totalAmount is required'],
      min:      [0, 'totalAmount cannot be negative'],
    },

    /**
     * Current fulfillment status of the order.
     * Lifecycle: ORDER_RECEIVED → PREPARING → OUT_FOR_DELIVERY → DELIVERED
     * Terminal states: DELIVERED, CANCELLED
     */
    status: {
      type:    String,
      enum:    ['ORDER_RECEIVED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
      default: 'ORDER_RECEIVED',
    },

    /**
     * Optional reason provided when an order is cancelled.
     * Selected from a predefined list or entered as free text by the customer.
     */
    cancellationReason: {
      type:    String,
      default: null,
    },

    /**
     * Role that initiated the cancellation (CUSTOMER | RESTAURANT_ADMIN | SUPER_ADMIN).
     */
    cancelledBy: {
      type:    String,
      enum:    ['CUSTOMER', 'RESTAURANT_ADMIN', 'SUPER_ADMIN', null],
      default: null,
    },

    /**
     * Timestamp when the order was cancelled.
     */
    cancelledAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);


// ---------------------------------------------------------------------------
// Model export
// ---------------------------------------------------------------------------

/**
 * Mongoose model for the 'orders' collection.
 * Import this wherever order documents need to be created, queried, or updated.
 */
module.exports = mongoose.model('Order', OrderSchema);
