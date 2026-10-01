/**
 * @file src/scripts/seedMenu.js
 * @description Seed script that creates a demo restaurant + admin user + rich menu
 *              for immediate testing of the FlashBite system.
 *
 * Run with: node src/scripts/seedMenu.js
 *
 * Creates:
 *  - Restaurant:  "FlashBite Demo Kitchen" (tenantId: fb-demo0001)
 *  - Admin user:  kitchen@flashbite.com / Kitchen@Demo99
 *  - 12 menu items across 4 categories: Burgers, Pizza, Sides, Drinks
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const User       = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Menu       = require('../models/menu.model');

const DEMO_TENANT   = 'fb-demo0001';
const DEMO_EMAIL    = 'kitchen@flashbite.com';
const DEMO_PASSWORD = 'Kitchen@Demo99';

const DEMO_MENU_ITEMS = [
  // ── Burgers ──────────────────────────────────────────────────────────
  {
    name: 'Classic Smash Burger',
    price: 12.99,
    category: 'Burgers',
    description: 'Double smash patty, American cheese, pickles, special sauce on brioche bun',
    emoji: '🍔',
    available: true,
  },
  {
    name: 'BBQ Bacon Stack',
    price: 14.99,
    category: 'Burgers',
    description: 'Crispy smoked bacon, aged cheddar, caramelized onions, smoky BBQ sauce',
    emoji: '🥓',
    available: true,
  },
  {
    name: 'Spicy Jalapeño Crunch',
    price: 13.49,
    category: 'Burgers',
    description: 'Fresh jalapeños, pepper jack cheese, sriracha aioli, crispy onion strings',
    emoji: '🌶️',
    available: true,
  },

  // ── Pizza ─────────────────────────────────────────────────────────────
  {
    name: 'Margherita Perfection',
    price: 13.99,
    category: 'Pizza',
    description: 'San Marzano tomato, fresh buffalo mozzarella, basil, extra-virgin olive oil',
    emoji: '🍕',
    available: true,
  },
  {
    name: 'Pepperoni Feast',
    price: 15.99,
    category: 'Pizza',
    description: 'Double-layer cup-and-char pepperoni, provolone blend, oregano, chili flakes',
    emoji: '🍕',
    available: true,
  },
  {
    name: 'Truffle Mushroom White',
    price: 16.49,
    category: 'Pizza',
    description: 'Garlic crème base, wild mushrooms, fontina, truffle oil, fresh thyme',
    emoji: '🍄',
    available: true,
  },

  // ── Sides ─────────────────────────────────────────────────────────────
  {
    name: 'Crispy Wings (8pc)',
    price: 9.99,
    category: 'Sides',
    description: 'Choice of buffalo, honey-garlic, or dry-rub seasoning. Served with blue cheese dip',
    emoji: '🍗',
    available: true,
  },
  {
    name: 'Loaded Truffle Fries',
    price: 7.99,
    category: 'Sides',
    description: 'Double-fried crinkle cut, parmesan, truffle oil, fresh parsley, aioli',
    emoji: '🍟',
    available: true,
  },
  {
    name: 'Mac & Cheese Bites',
    price: 6.99,
    category: 'Sides',
    description: 'Panko-crusted, gooey four-cheese blend, served with ranch dipping sauce',
    emoji: '🧀',
    available: true,
  },

  // ── Drinks ────────────────────────────────────────────────────────────
  {
    name: 'Craft Lemonade',
    price: 3.99,
    category: 'Drinks',
    description: 'Fresh-squeezed Meyer lemons, raw honey, fresh mint, sparkling water',
    emoji: '🍋',
    available: true,
  },
  {
    name: 'Signature Shake',
    price: 5.99,
    category: 'Drinks',
    description: 'Hand-spun with premium ice cream — Vanilla Bean, Chocolate Fudge, or Strawberry',
    emoji: '🥤',
    available: true,
  },
  {
    name: 'Cold Brew Float',
    price: 4.99,
    category: 'Drinks',
    description: 'Single-origin cold brew topped with a scoop of vanilla bean ice cream',
    emoji: '☕',
    available: true,
  },
];

async function seedMenu() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('[SeedMenu] ERROR: MONGO_URI not set.');
    process.exit(1);
  }

  console.log('[SeedMenu] Connecting to MongoDB…');
  await mongoose.connect(mongoUri);
  console.log(`[SeedMenu] Connected: ${mongoose.connection.host}`);

  try {
    // ── 1. Upsert Restaurant ───────────────────────────────────────────
    let restaurant = await Restaurant.findOne({ tenantId: DEMO_TENANT });
    if (!restaurant) {
      restaurant = await Restaurant.create({
        tenantId: DEMO_TENANT,
        name: 'FlashBite Demo Kitchen',
        location: 'Downtown, Demo City',
        isActive: true,
      });
      console.log(`[SeedMenu] ✅ Restaurant created: ${restaurant.name} (${DEMO_TENANT})`);
    } else {
      console.log(`[SeedMenu] Restaurant already exists: ${restaurant.name}`);
    }

    // ── 2. Upsert Admin User ───────────────────────────────────────────
    let admin = await User.findOne({ email: DEMO_EMAIL });
    if (!admin) {
      admin = await User.create({
        name: 'Demo Kitchen Admin',
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD, // hashed by pre-save hook
        role: 'RESTAURANT_ADMIN',
        tenantId: DEMO_TENANT,
      });
      // Link restaurant to owner
      restaurant.ownerId = admin._id;
      await restaurant.save();
      console.log(`[SeedMenu] ✅ Admin user created: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    } else {
      console.log(`[SeedMenu] Admin user already exists: ${DEMO_EMAIL}`);
    }

    // ── 3. Upsert Menu ─────────────────────────────────────────────────
    const existingMenu = await Menu.findOne({ tenantId: DEMO_TENANT });
    if (existingMenu) {
      console.log(`[SeedMenu] Menu already exists (${existingMenu.items.length} items). Skipping.`);
    } else {
      await Menu.create({
        tenantId: DEMO_TENANT,
        restaurantId: restaurant._id,
        items: DEMO_MENU_ITEMS,
      });
      console.log(`[SeedMenu] ✅ Menu seeded with ${DEMO_MENU_ITEMS.length} items across 4 categories.`);
    }

    console.log('\n[SeedMenu] ─────────────────────────────────────────────────');
    console.log('  Demo tenant ID :  fb-demo0001');
    console.log('  Kitchen admin  :  kitchen@flashbite.com / Kitchen@Demo99');
    console.log('  Customer test  :  Register as CUSTOMER at /login');
    console.log('  Menu endpoint  :  GET /api/menu/fb-demo0001');
    console.log('[SeedMenu] ─────────────────────────────────────────────────\n');

  } catch (err) {
    console.error('[SeedMenu] Error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('[SeedMenu] Disconnected. Done.');
  }
}

if (require.main === module) {
  seedMenu();
}
