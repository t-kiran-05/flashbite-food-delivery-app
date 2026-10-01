/**
 * @file src/controllers/searchController.js
 * @description Controller for AI-Powered Natural Language Craving Search.
 *              Translates conversational search queries into structured criteria
 *              using Google Gemini (gemini-2.5-flash) and queries MongoDB.
 */

'use strict';

const { GoogleGenAI, Type } = require('@google/genai');
const MenuItem = require('../models/MenuItem');
const Menu = require('../models/menu.model');
const Restaurant = require('../models/Restaurant');

/**
 * Helper to safely retrieve and clean the Gemini API key from environment.
 * Handles surrounding quotes and fallback variable names.
 * @returns {string|null}
 */
function getGeminiApiKey() {
  const rawKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    '';

  const cleaned = rawKey.trim().replace(/^["']|["']$/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Fallback heuristic parser when Gemini API key is missing or service is unavailable.
 * Extracts keywords, max price, dietary tags, and spice preference via regex.
 * @param {string} rawQuery
 * @returns {{ keywords: string[], maxPrice: number|null, dietaryTags: string[], isSpicy: boolean|null }}
 */
function fallbackParseCraving(rawQuery) {
  const query = rawQuery.toLowerCase();

  // Extract max price (e.g., "under $15", "< 20", "15 dollars", "below 12.50")
  let maxPrice = null;
  const priceMatch =
    query.match(/(?:under|below|less than|max|up to|\$)\s*\$?(\d+(?:\.\d+)?)/i) ||
    query.match(/(\d+(?:\.\d+)?)\s*(?:\$|dollars|bucks)/i);
  if (priceMatch) {
    maxPrice = parseFloat(priceMatch[1]);
  }

  // Extract dietary preferences
  const dietaryTags = [];
  if (/\bvegan\b/i.test(query)) dietaryTags.push('VEGAN');
  if (/\bhalal\b/i.test(query)) dietaryTags.push('HALAL');
  if (/\bgluten[- ]?free\b/i.test(query)) dietaryTags.push('GLUTEN_FREE');
  if (/\bvegetarian\b/i.test(query)) dietaryTags.push('VEGETARIAN');
  if (/\bdairy[- ]?free\b/i.test(query)) dietaryTags.push('DAIRY_FREE');
  if (/\bketo\b/i.test(query)) dietaryTags.push('KETO');

  // Extract spice preference
  let isSpicy = null;
  if (/\b(spicy|hot|fiery|chili|jalapeno|jalapeño|sriracha|pepper|wings)\b/i.test(query)) {
    isSpicy = true;
  } else if (/\b(mild|not spicy|non[- ]spicy|sweet)\b/i.test(query)) {
    isSpicy = false;
  }

  // Filter stop words to extract meaningful search keywords
  const stopWords = new Set([
    'a', 'an', 'the', 'under', 'below', 'less', 'than', 'max', 'for', 'with',
    'in', 'and', 'or', 'i', 'want', 'craving', 'crave', 'need', 'looking',
    'some', 'food', 'something', 'bucks', 'dollars', 'cheap', 'best', 'me', 'to', 'eat'
  ]);

  const keywords = query
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w) && isNaN(Number(w)));

  return {
    keywords: keywords.length > 0 ? keywords : [rawQuery.trim()],
    maxPrice,
    dietaryTags,
    isSpicy,
  };
}

/**
 * Sends natural language query to Gemini 2.5 Flash and returns structured search criteria.
 * @param {string} promptText
 * @param {string} apiKey
 * @returns {Promise<{ keywords: string[], maxPrice: number|null, dietaryTags: string[], isSpicy: boolean|null }>}
 */
async function parseCravingWithGemini(promptText, apiKey) {
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction =
    'You are a culinary search intelligence analyzer for the FlashBite food delivery platform. ' +
    'Extract structured search criteria from the user\'s conversational food craving query. ' +
    'Extract keywords (dishes, ingredients, cuisines), maxPrice (number or null), dietaryTags (e.g. VEGAN, HALAL, GLUTEN_FREE), and isSpicy (true/false/null).';

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: promptText,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          keywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Food items, ingredients, cuisines, or dish categories mentioned or implied',
          },
          maxPrice: {
            type: Type.NUMBER,
            description: 'Maximum price or budget limit extracted as a numeric value, or null if not stated',
            nullable: true,
          },
          dietaryTags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Dietary requirements such as VEGAN, HALAL, GLUTEN_FREE, VEGETARIAN, DAIRY_FREE, KETO',
          },
          isSpicy: {
            type: Type.BOOLEAN,
            description: 'true if spicy requested, false if mild requested, null if spicy level was not specified',
            nullable: true,
          },
        },
        required: ['keywords', 'dietaryTags'],
      },
    },
  });

  const rawJson = response.text ? response.text.trim() : '{}';
  const parsed = JSON.parse(rawJson);

  return {
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    maxPrice: typeof parsed.maxPrice === 'number' && !isNaN(parsed.maxPrice) ? parsed.maxPrice : null,
    dietaryTags: Array.isArray(parsed.dietaryTags) ? parsed.dietaryTags : [],
    isSpicy: typeof parsed.isSpicy === 'boolean' ? parsed.isSpicy : null,
  };
}

/**
 * Build dynamic MongoDB query from parsed AI criteria.
 * Matches keywords against name, description, category, and tags using $or with case-insensitive regex.
 * @param {object} criteria
 * @returns {object}
 */
function buildMongoFilter(criteria) {
  const andConditions = [{ available: { $ne: false } }];

  // 1. Keyword search against name, description, category, and tags
  if (Array.isArray(criteria.keywords) && criteria.keywords.length > 0) {
    const validKws = criteria.keywords
      .map((k) => String(k).trim())
      .filter((k) => k.length > 0);

    if (validKws.length > 0) {
      const kwOrConditions = validKws.map((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        return {
          $or: [
            { name: regex },
            { description: regex },
            { category: regex },
            { tags: regex },
          ],
        };
      });

      // Match items satisfying any of the extracted keyword conditions
      andConditions.push({ $or: kwOrConditions.map((c) => c.$or).flat() });
    }
  }

  // 2. Max Price constraint
  if (typeof criteria.maxPrice === 'number' && criteria.maxPrice > 0) {
    andConditions.push({ price: { $lte: criteria.maxPrice } });
  }

  // 3. Dietary Tags constraint
  if (Array.isArray(criteria.dietaryTags) && criteria.dietaryTags.length > 0) {
    const tagRegexes = criteria.dietaryTags
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0)
      .map((t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

    if (tagRegexes.length > 0) {
      andConditions.push({ tags: { $in: tagRegexes } });
    }
  }

  // 4. Spice Level constraint
  if (typeof criteria.isSpicy === 'boolean') {
    if (criteria.isSpicy) {
      andConditions.push({
        $or: [
          { isSpicy: true },
          { tags: /spicy/i },
          { name: /spicy|hot|jalapeño|jalapeno|chili|sriracha|pepper|buffalo|fire/i },
          { description: /spicy|hot|jalapeño|jalapeno|chili|sriracha|pepper|buffalo|fire/i },
        ],
      });
    } else {
      andConditions.push({
        isSpicy: { $ne: true },
        name: { $not: /spicy|fiery|sriracha|jalapeño|jalapeno/i },
      });
    }
  }

  return andConditions.length > 1 ? { $and: andConditions } : andConditions[0] || {};
}

/**
 * POST /api/search/craving
 * Translates conversational search queries into structured MongoDB filters using Gemini 2.5 Flash.
 */
async function searchByCraving(req, res) {
  const { query } = req.body || {};

  // 1. Validation: Gracefully handle empty or invalid queries
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid craving query (e.g., "spicy comfort food under $15").',
    });
  }

  const sanitizedQuery = query.trim();
  const apiKey = getGeminiApiKey();

  let criteria;
  let aiSource = 'gemini-2.5-flash';
  let warningMessage = null;

  // 2. Process query with Gemini model or graceful fallback
  if (apiKey) {
    try {
      criteria = await parseCravingWithGemini(sanitizedQuery, apiKey);
    } catch (geminiErr) {
      console.warn('[CravingSearch] Gemini API error, falling back to heuristic parser:', geminiErr.message);
      criteria = fallbackParseCraving(sanitizedQuery);
      aiSource = 'heuristic-fallback';
      warningMessage = 'AI service temporarily unavailable. Using intelligent fallback parsing.';
    }
  } else {
    console.warn('[CravingSearch] GEMINI_API_KEY not configured. Using heuristic fallback parser.');
    criteria = fallbackParseCraving(sanitizedQuery);
    aiSource = 'heuristic-fallback';
    warningMessage = 'GEMINI_API_KEY is not configured on server. Operating in fallback mode.';
  }

  try {
    // 3. Construct dynamic MongoDB query
    const mongoFilter = buildMongoFilter(criteria);

    // 4. Query MenuItem collection with populated restaurantId (name, location, rating)
    let items = await MenuItem.find(mongoFilter)
      .populate('restaurantId', 'name location rating tenantId')
      .limit(20)
      .lean();

    // 5. Fallback aggregation: If MenuItem standalone collection is empty, search embedded items in Menu collection
    if (!items || items.length === 0) {
      const menus = await Menu.find()
        .populate('restaurantId', 'name location rating tenantId')
        .lean();

      const matchedEmbedded = [];

      for (const menu of menus) {
        if (!menu.items || !Array.isArray(menu.items)) continue;

        // Determine restaurant metadata
        let restaurantData = menu.restaurantId;
        if (!restaurantData) {
          const matchedRest = await Restaurant.findOne({ tenantId: menu.tenantId }).lean();
          if (matchedRest) {
            restaurantData = {
              _id: matchedRest._id,
              name: matchedRest.name,
              location: matchedRest.location,
              rating: matchedRest.rating || 4.5,
              tenantId: matchedRest.tenantId,
            };
          } else {
            restaurantData = {
              _id: null,
              name: 'FlashBite Restaurant',
              location: 'City Center',
              rating: 4.8,
              tenantId: menu.tenantId,
            };
          }
        }

        for (const item of menu.items) {
          if (item.available === false) continue;

          let matches = true;

          // Check maxPrice
          if (typeof criteria.maxPrice === 'number' && criteria.maxPrice > 0) {
            if (item.price > criteria.maxPrice) {
              matches = false;
            }
          }

          // Check isSpicy
          if (matches && typeof criteria.isSpicy === 'boolean') {
            const isItemSpicy =
              item.isSpicy ||
              /spicy|hot|jalapeño|jalapeno|chili|sriracha|pepper|buffalo|fire/i.test(
                `${item.name} ${item.description} ${(item.tags || []).join(' ')}`
              );

            if (criteria.isSpicy && !isItemSpicy) matches = false;
            if (!criteria.isSpicy && isItemSpicy) matches = false;
          }

          // Check keywords
          if (matches && Array.isArray(criteria.keywords) && criteria.keywords.length > 0) {
            const itemText = `${item.name} ${item.description} ${item.category} ${(item.tags || []).join(' ')}`.toLowerCase();
            const hasKeywordMatch = criteria.keywords.some((kw) =>
              itemText.includes(String(kw).toLowerCase().trim())
            );
            if (!hasKeywordMatch) matches = false;
          }

          if (matches) {
            matchedEmbedded.push({
              _id: item._id,
              name: item.name,
              price: item.price,
              category: item.category,
              description: item.description,
              emoji: item.emoji || '🍽️',
              available: item.available !== false,
              tags: item.tags || [],
              isSpicy: Boolean(item.isSpicy),
              tenantId: menu.tenantId,
              restaurantId: restaurantData,
            });
          }
        }
      }

      items = matchedEmbedded.slice(0, 20);
    }

    // 6. Return response conforming to requirements
    return res.status(200).json({
      success: true,
      query: sanitizedQuery,
      source: aiSource,
      criteria,
      count: items.length,
      items,
      ...(warningMessage && { warning: warningMessage }),
    });
  } catch (dbErr) {
    console.error('[CravingSearch] Database query error:', dbErr);
    return res.status(500).json({
      success: false,
      error: 'Failed to search menu items due to an internal error.',
    });
  }
}

module.exports = {
  searchByCraving,
  getGeminiApiKey,
  fallbackParseCraving,
  buildMongoFilter,
};
