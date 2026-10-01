/**
 * Restaurant Routes.
 *
 * GET  /restaurants      – List all restaurants for tenant (JWT + tenantScope)
 * POST /restaurants      – Create restaurant (restaurant/admin role only)
 * GET  /restaurants/:id  – Get single restaurant details
 * PUT  /restaurants/:id  – Update restaurant (owner/admin only)
 *
 * From skeleton routes/restaurant.routes.js, extended with full CRUD and tenantId scoping.
 */
"use strict";
const express = require("express");
const { body, validationResult } = require("express-validator");

const Restaurant = require("../models/restaurant.model");
const { verifyJWT } = require("../middleware/auth");
const { tenantScope } = require("../middleware/tenant");

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /restaurants – list all restaurants for tenant
// ---------------------------------------------------------------------------
router.get("/", verifyJWT, tenantScope, async (req, res) => {
  try {
    const list = await Restaurant.find({ tenantId: req.tenantId }).lean();
    res.json(list);
  } catch (err) {
    console.error("List restaurants error:", err);
    res.status(500).json({ error: "Failed to list restaurants." });
  }
});

// ---------------------------------------------------------------------------
// POST /restaurants – create restaurant
// ---------------------------------------------------------------------------
router.post(
  "/",
  verifyJWT,
  tenantScope,
  [
    body("name").isString().notEmpty().withMessage("Restaurant name is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!["restaurant", "admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only restaurant owners or admins can create restaurants." });
    }

    const { name, address, menu } = req.body;

    try {
      const restaurant = await Restaurant.create({
        tenantId: req.tenantId,
        name,
        address: address || "",
        menu: menu || [],
      });
      res.status(201).json(restaurant);
    } catch (err) {
      console.error("Create restaurant error:", err);
      res.status(500).json({ error: "Failed to create restaurant." });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /restaurants/:id – single restaurant
// ---------------------------------------------------------------------------
router.get("/:id", verifyJWT, tenantScope, async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).lean();
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
    res.json(restaurant);
  } catch (err) {
    console.error("Get restaurant error:", err);
    res.status(500).json({ error: "Failed to fetch restaurant." });
  }
});

// ---------------------------------------------------------------------------
// PUT /restaurants/:id – update restaurant
// ---------------------------------------------------------------------------
router.put("/:id", verifyJWT, tenantScope, async (req, res) => {
  if (!["restaurant", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Only restaurant owners or admins can update restaurants." });
  }

  try {
    const restaurant = await Restaurant.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: req.body },
      { new: true }
    );
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
    res.json(restaurant);
  } catch (err) {
    console.error("Update restaurant error:", err);
    res.status(500).json({ error: "Failed to update restaurant." });
  }
});

module.exports = router;
