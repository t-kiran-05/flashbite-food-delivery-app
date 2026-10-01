/**
 * @file src/routes/menu.js
 * @description Menu management API for FlashBite multi-tenant system.
 *
 *  GET  /api/menu/:tenantId          — Public: fetch active menu for a restaurant
 *  POST /api/menu                    — RESTAURANT_ADMIN: create/replace full menu
 *  POST /api/menu/item               — RESTAURANT_ADMIN: add single item
 *  PATCH /api/menu/item/:itemId      — RESTAURANT_ADMIN: update single item
 *  DELETE /api/menu/item/:itemId     — RESTAURANT_ADMIN: delete single item
 *  GET  /api/menu/manage             — RESTAURANT_ADMIN: get own menu for management
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const { body, param, validationResult } = require('express-validator');

const Menu       = require('../models/menu.model');
const Restaurant = require('../models/Restaurant');
const redisClient = require('../services/redisClient');
const { verifyJWT, requireRole } = require('../middleware/auth');

// ─── Cache TTL ────────────────────────────────────────────────────────────────
/** Menu data cached for 5 minutes in Redis to reduce DB hits. */
const MENU_CACHE_TTL = 300; // seconds

// ─── Validation Errors Helper ─────────────────────────────────────────────────
function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

// ─── Redis Cache Helpers ───────────────────────────────────────────────────────
/** Cache key for a tenant's menu. */
const menuCacheKey = (tenantId) => `menu:${tenantId}`;

/** Read menu from Redis cache. Returns null on miss or error. */
async function getMenuFromCache(tenantId) {
  try {
    const raw = await redisClient.get(menuCacheKey(tenantId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null; // cache miss is non-fatal
  }
}

/** Write menu to Redis cache. Fire-and-forget (non-fatal on error). */
async function setMenuCache(tenantId, menuData) {
  try {
    await redisClient.set(menuCacheKey(tenantId), JSON.stringify(menuData), { EX: MENU_CACHE_TTL });
  } catch (_) { /* non-fatal */ }
}

/** Invalidate menu cache when items change. */
async function invalidateMenuCache(tenantId) {
  try {
    await redisClient.del(menuCacheKey(tenantId));
  } catch (_) { /* non-fatal */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/menu/:tenantId  — Public endpoint, cached
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   GET /api/menu/:tenantId
 * @desc    Returns active menu items for a restaurant. Used by the customer page.
 *          Checks Redis cache first; falls back to MongoDB on cache miss.
 * @access  Public (no auth required — menus are publicly readable)
 */
router.get('/:tenantId', async (req, res) => {
  const { tenantId } = req.params;

  // 1. Try Redis cache first
  const cached = await getMenuFromCache(tenantId);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    // 2. Verify restaurant exists and is active
    const restaurant = await Restaurant.findOne({ tenantId }).lean();
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found.' });
    }
    if (!restaurant.isActive) {
      return res.status(403).json({ error: 'This restaurant is currently unavailable.' });
    }

    // 3. Fetch menu from DB
    let menu = await Menu.findOne({ tenantId }).lean();

    // 4. If no menu created yet, return empty menu with restaurant info
    if (!menu) {
      const result = {
        tenantId,
        restaurantName: restaurant.name,
        restaurantLocation: restaurant.location,
        items: [],
      };
      await setMenuCache(tenantId, result);
      return res.json(result);
    }

    const result = {
      tenantId,
      restaurantName: restaurant.name,
      restaurantLocation: restaurant.location,
      items: menu.items.filter(i => i.available), // only show available items
    };

    // 5. Cache and respond
    await setMenuCache(tenantId, result);
    res.json(result);
  } catch (err) {
    console.error('[MENU] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch menu.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/menu/manage  — Authenticated: full menu including unavailable items
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   GET /api/menu/manage
 * @desc    Returns the full menu (all items incl. unavailable) for the authenticated
 *          restaurant admin. Used by the restaurant management panel.
 * @access  Private — RESTAURANT_ADMIN
 */
router.get('/manage', verifyJWT, requireRole('RESTAURANT_ADMIN'), async (req, res) => {
  const { tenantId } = req.user;
  try {
    let menu = await Menu.findOne({ tenantId }).lean();
    if (!menu) {
      return res.json({ tenantId, items: [] });
    }
    res.json(menu);
  } catch (err) {
    console.error('[MENU] Manage GET error:', err);
    res.status(500).json({ error: 'Failed to fetch menu.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/menu/item  — Add single item
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   POST /api/menu/item
 * @desc    Adds a single item to the authenticated restaurant's menu.
 *          Creates the Menu document if it doesn't exist yet.
 * @access  Private — RESTAURANT_ADMIN
 */
router.post(
  '/item',
  verifyJWT,
  requireRole('RESTAURANT_ADMIN'),
  [
    body('name').trim().notEmpty().withMessage('Item name is required.'),
    body('price').isFloat({ min: 0.01 }).withMessage('Price must be a positive number.'),
    body('category').optional().trim(),
    body('description').optional().trim(),
    body('emoji').optional().trim(),
    body('available').optional().isBoolean(),
  ],
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { tenantId } = req.user;
    const { name, price, category, description, emoji, available } = req.body;

    try {
      // Upsert: create Menu doc if doesn't exist, then push new item
      const menu = await Menu.findOneAndUpdate(
        { tenantId },
        {
          $push: {
            items: {
              name,
              price: parseFloat(price),
              category: category || 'main',
              description: description || '',
              emoji: emoji || '🍽️',
              available: available !== false,
            },
          },
        },
        { new: true, upsert: true }
      );

      await invalidateMenuCache(tenantId);
      res.status(201).json({ message: 'Item added successfully.', menu });
    } catch (err) {
      console.error('[MENU] Add item error:', err);
      res.status(500).json({ error: 'Failed to add menu item.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/menu/item/:itemId  — Update single item
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   PATCH /api/menu/item/:itemId
 * @desc    Updates a specific menu item for the authenticated restaurant.
 * @access  Private — RESTAURANT_ADMIN
 */
router.patch(
  '/item/:itemId',
  verifyJWT,
  requireRole('RESTAURANT_ADMIN'),
  async (req, res) => {
    const { tenantId } = req.user;
    const { itemId } = req.params;
    const updates = req.body;

    // Build $set with positional operator (update only the matched array element)
    const setFields = {};
    const allowed = ['name', 'price', 'category', 'description', 'emoji', 'available'];
    allowed.forEach((field) => {
      if (updates[field] !== undefined) {
        setFields[`items.$.${field}`] = updates[field];
      }
    });

    try {
      const menu = await Menu.findOneAndUpdate(
        { tenantId, 'items._id': itemId },
        { $set: setFields },
        { new: true }
      );

      if (!menu) {
        return res.status(404).json({ error: 'Menu item not found.' });
      }

      await invalidateMenuCache(tenantId);
      res.json({ message: 'Item updated.', menu });
    } catch (err) {
      console.error('[MENU] Update item error:', err);
      res.status(500).json({ error: 'Failed to update menu item.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/menu/item/:itemId  — Remove single item
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   DELETE /api/menu/item/:itemId
 * @desc    Removes a specific item from the restaurant's menu.
 * @access  Private — RESTAURANT_ADMIN
 */
router.delete(
  '/item/:itemId',
  verifyJWT,
  requireRole('RESTAURANT_ADMIN'),
  async (req, res) => {
    const { tenantId } = req.user;
    const { itemId } = req.params;

    try {
      const menu = await Menu.findOneAndUpdate(
        { tenantId },
        { $pull: { items: { _id: itemId } } },
        { new: true }
      );

      if (!menu) {
        return res.status(404).json({ error: 'Menu not found.' });
      }

      await invalidateMenuCache(tenantId);
      res.json({ message: 'Item removed.', menu });
    } catch (err) {
      console.error('[MENU] Delete item error:', err);
      res.status(500).json({ error: 'Failed to delete menu item.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/menu/toggle/:itemId  — Toggle availability
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @route   POST /api/menu/toggle/:itemId
 * @desc    Toggles an item's available flag (quick kitchen action for 86'ing items).
 * @access  Private — RESTAURANT_ADMIN
 */
router.post(
  '/toggle/:itemId',
  verifyJWT,
  requireRole('RESTAURANT_ADMIN'),
  async (req, res) => {
    const { tenantId } = req.user;
    const { itemId } = req.params;

    try {
      const menu = await Menu.findOne({ tenantId });
      if (!menu) return res.status(404).json({ error: 'Menu not found.' });

      const item = menu.items.id(itemId);
      if (!item) return res.status(404).json({ error: 'Item not found.' });

      item.available = !item.available;
      await menu.save();

      await invalidateMenuCache(tenantId);
      res.json({ message: `Item ${item.available ? 'enabled' : 'disabled'}.`, available: item.available });
    } catch (err) {
      console.error('[MENU] Toggle error:', err);
      res.status(500).json({ error: 'Failed to toggle item.' });
    }
  }
);

module.exports = router;
