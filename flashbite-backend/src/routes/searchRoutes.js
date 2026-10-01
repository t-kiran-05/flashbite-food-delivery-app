/**
 * @file src/routes/searchRoutes.js
 * @description API routes for AI-powered craving search.
 *
 *  POST /api/search/craving  — Translates natural language craving into menu items
 */

'use strict';

const express = require('express');
const router = express.Router();
const { searchByCraving } = require('../controllers/searchController');

/**
 * @route   POST /api/search/craving
 * @desc    AI-Powered Natural Language Craving Search
 * @access  Public
 */
router.post('/craving', searchByCraving);

module.exports = router;
