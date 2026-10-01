/**
 * Menu Routes (from legacy /routes/menus.js + MongoDB).
 *
 * GET  /menus          – Return menus for tenant (Redis-cached, 1hr TTL)
 * POST /menus          – Create/add menu item (restaurant or admin role only)
 * PUT  /menus/:id      – Update a menu item
 * DELETE /menus/:id    – Remove a menu item (admin only)
 *
 * Caching strategy:
 *   - On GET: check Redis key "menus:<tenantId>". If hit, return cached JSON.
 *   - On POST/PUT/DELETE: write to MongoDB then invalidate Redis key.
 */
"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");

const Menu = require("../models/menu.model");
const { verifyJWT } = require("../middleware/auth");
const { tenantScope } = require("../middleware/tenant");
const redisClient = require("../services/redisClient");

const router = express.Router();
const MENU_CACHE_TTL = 3600; // 1 hour

// ---------------------------------------------------------------------------
// GET /menus – Redis-cached menus per tenant
// ---------------------------------------------------------------------------
router.get("/", verifyJWT, tenantScope, async (req, res) => {
  const cacheKey = `menus:${req.tenantId}`;

  try {
    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json({ source: "cache", menus: JSON.parse(cached) });
    }

    // Fetch from MongoDB
    const menus = await Menu.find({ tenantId: req.tenantId }).lean();

    // Populate cache
    await redisClient.set(cacheKey, JSON.stringify(menus), { EX: MENU_CACHE_TTL });

    res.json({ source: "db", menus });
  } catch (err) {
    console.error("Get menus error:", err);
    res.status(500).json({ error: "Failed to fetch menus." });
  }
});

// ---------------------------------------------------------------------------
// POST /menus – create menu (restaurant/admin only)
// ---------------------------------------------------------------------------
router.post(
  "/",
  verifyJWT,
  tenantScope,
  [
    body("items").isArray({ min: 1 }).withMessage("items must be a non-empty array"),
    body("items.*.name").isString().notEmpty(),
    body("items.*.price").isNumeric(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!["restaurant", "admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only restaurant owners or admins can manage menus." });
    }

    const { items, restaurantId } = req.body;

    try {
      const menu = await Menu.create({
        tenantId: req.tenantId,
        restaurantId: restaurantId || null,
        items,
      });

      // Invalidate cache
      await redisClient.del(`menus:${req.tenantId}`);

      res.status(201).json({ menu });
    } catch (err) {
      console.error("Create menu error:", err);
      res.status(500).json({ error: "Failed to create menu." });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /menus/:id – update menu
// ---------------------------------------------------------------------------
router.put("/:id", verifyJWT, tenantScope, async (req, res) => {
  if (!["restaurant", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Only restaurant owners or admins can update menus." });
  }

  try {
    const menu = await Menu.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: req.body },
      { new: true }
    );
    if (!menu) return res.status(404).json({ error: "Menu not found." });

    // Invalidate cache
    await redisClient.del(`menus:${req.tenantId}`);

    res.json({ menu });
  } catch (err) {
    console.error("Update menu error:", err);
    res.status(500).json({ error: "Failed to update menu." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /menus/:id – delete menu (admin only)
// ---------------------------------------------------------------------------
router.delete("/:id", verifyJWT, tenantScope, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can delete menus." });
  }

  try {
    const result = await Menu.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!result) return res.status(404).json({ error: "Menu not found." });

    // Invalidate cache
    await redisClient.del(`menus:${req.tenantId}`);

    res.json({ message: "Menu deleted." });
  } catch (err) {
    console.error("Delete menu error:", err);
    res.status(500).json({ error: "Failed to delete menu." });
  }
});

module.exports = router;
