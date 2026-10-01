"use client";

/**
 * @file components/AiCravingSearchBar.tsx
 * @description AI-Powered Natural Language Craving Search Component for FlashBite.
 *              Uses Gemini 2.5 Flash on the backend to translate conversational craving
 *              prompts into structured MongoDB filters with removable badges and dish cards.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Search,
  Loader2,
  X,
  Plus,
  Flame,
  DollarSign,
  Tag,
  Star,
  MapPin,
  Utensils,
  HelpCircle,
} from "lucide-react";
import api from "@/lib/api";
import type { MenuItem, CravingCriteria, CravingSearchResponse } from "@/lib/types";
import toast from "react-hot-toast";

interface AiCravingSearchBarProps {
  onAddToCart?: (item: MenuItem) => void;
  className?: string;
}

const SAMPLE_CRAVINGS = [
  "🌶️ Spicy burger under $15",
  "🍕 Cheesy truffle pizza",
  "🍟 Loaded fries under $8",
  "🍗 Crispy wings with dip",
  "🥤 Hand-spun sweet shake",
];

export default function AiCravingSearchBar({ onAddToCart, className = "" }: AiCravingSearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MenuItem[]>([]);
  const [activeCriteria, setActiveCriteria] = useState<CravingCriteria | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [addedItemIds, setAddedItemIds] = useState<Set<string>>(new Set());
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [aiSource, setAiSource] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Perform AI craving search
  const executeSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      toast.error("Please enter a craving or food description to search.");
      return;
    }

    setLoading(true);
    setHasSearched(true);
    setLastSearchedQuery(trimmed);

    try {
      const response = await api.post<CravingSearchResponse>("/api/search/craving", {
        query: trimmed,
      });

      const { data } = response;
      if (data.success) {
        setResults(data.items || []);
        setActiveCriteria(data.criteria || null);
        setAiSource(data.source || "gemini-2.5-flash");

        if (data.warning) {
          toast(data.warning, { icon: "ℹ️" });
        }

        if ((data.items || []).length === 0) {
          toast("No matching dishes found for that craving. Try tweaking your price or keywords!", {
            icon: "🍽️",
          });
        }
      } else {
        toast.error(data.error || "Failed to process craving query");
      }
    } catch (err: unknown) {
      const errResponse = (err as { response?: { data?: { error?: string } } })?.response;
      const errorMsg = errResponse?.data?.error || "Unable to reach the AI Craving Search service.";
      toast.error(errorMsg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle debounced typing (after 800ms of inactivity if query is at least 3 chars)
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (value.trim().length >= 4) {
      debounceTimerRef.current = setTimeout(() => {
        executeSearch(value);
      }, 800);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      executeSearch(query);
    }
  };

  const handleSampleClick = (sample: string) => {
    // Strip leading emoji for clean prompt
    const cleanPrompt = sample.replace(/^[^\w]+/, "");
    setQuery(cleanPrompt);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    executeSearch(cleanPrompt);
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setActiveCriteria(null);
    setHasSearched(false);
    setLastSearchedQuery("");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  };

  // Remove individual filter badges & dynamically update client result filtering
  const removeKeyword = (kwToRemove: string) => {
    if (!activeCriteria) return;
    const updatedKeywords = activeCriteria.keywords.filter((k) => k !== kwToRemove);
    const updatedCriteria: CravingCriteria = { ...activeCriteria, keywords: updatedKeywords };
    setActiveCriteria(updatedCriteria);
    filterResultsLocally(updatedCriteria);
  };

  const removeMaxPrice = () => {
    if (!activeCriteria) return;
    const updatedCriteria: CravingCriteria = { ...activeCriteria, maxPrice: null };
    setActiveCriteria(updatedCriteria);
    filterResultsLocally(updatedCriteria);
  };

  const removeDietaryTag = (tagToRemove: string) => {
    if (!activeCriteria) return;
    const updatedTags = activeCriteria.dietaryTags.filter((t) => t !== tagToRemove);
    const updatedCriteria: CravingCriteria = { ...activeCriteria, dietaryTags: updatedTags };
    setActiveCriteria(updatedCriteria);
    filterResultsLocally(updatedCriteria);
  };

  const removeSpiceFilter = () => {
    if (!activeCriteria) return;
    const updatedCriteria: CravingCriteria = { ...activeCriteria, isSpicy: null };
    setActiveCriteria(updatedCriteria);
    filterResultsLocally(updatedCriteria);
  };

  // Local filter adjustment when badges are dismissed
  const filterResultsLocally = (criteria: CravingCriteria) => {
    setResults((prev) => {
      return prev.filter((item) => {
        if (criteria.maxPrice !== null && item.price > criteria.maxPrice) return false;
        return true;
      });
    });
  };

  const handleAddDish = (item: MenuItem) => {
    if (onAddToCart) {
      onAddToCart(item);
    }
    setAddedItemIds((prev) => new Set(prev).add(item._id));
    toast.success(`Added ${item.name} to cart! 🛒`);
    setTimeout(() => {
      setAddedItemIds((prev) => {
        const next = new Set(prev);
        next.delete(item._id);
        return next;
      });
    }, 1500);
  };

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return (
    <div className={`w-full ${className}`}>
      {/* ── AI Search Bar Container ── */}
      <div className="relative bg-gradient-to-r from-orange-500/10 via-brand-card to-amber-500/10 border border-brand-accent/30 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all hover:border-brand-accent/50">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-accent/20 border border-brand-accent/40 text-brand-accent">
            <Sparkles size={18} className="animate-pulse" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#f1f5f9] flex items-center gap-2">
              AI Craving Search
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-brand-accent/20 text-brand-accent border border-brand-accent/30">
                Gemini 2.5
              </span>
            </h2>
            <p className="text-xs text-[#94a3b8]">
              Describe your mood or craving in natural language and let AI find your perfect meal.
            </p>
          </div>
        </div>

        {/* Input & Action Button */}
        <div className="relative mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-accent pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Spicy noodles or cheesy pizza under $15"
              className="w-full bg-brand-bg border border-brand-border hover:border-brand-accent/60 focus:border-brand-accent rounded-xl pl-11 pr-10 py-3 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none transition-all shadow-inner"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#f1f5f9] p-1 rounded-full transition-colors"
                title="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => executeSearch(query)}
            disabled={loading || !query.trim()}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-accent hover:bg-brand-accent-h text-white font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-brand-accent/20 shrink-0"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span className="hidden sm:inline">Thinking…</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>Search</span>
              </>
            )}
          </button>
        </div>

        {/* Sample Suggestions */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#64748b] flex items-center gap-1">
            <HelpCircle size={12} /> Try asking:
          </span>
          {SAMPLE_CRAVINGS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => handleSampleClick(sample)}
              className="text-[11px] bg-brand-bg/80 hover:bg-brand-hover text-[#94a3b8] hover:text-[#f1f5f9] border border-brand-border/60 hover:border-brand-accent/40 px-2.5 py-1 rounded-lg transition-all"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* ── Active AI Filter Badges ── */}
      {activeCriteria && (
        <div className="mt-4 flex items-center gap-2 flex-wrap bg-brand-card/70 border border-brand-border rounded-xl p-3 animate-fade-in">
          <span className="text-xs font-bold text-[#94a3b8] flex items-center gap-1">
            <Tag size={13} className="text-brand-accent" /> Active AI Criteria:
          </span>

          {/* Keywords */}
          {activeCriteria.keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand-accent/15 border border-brand-accent/30 text-xs font-semibold text-brand-accent"
            >
              <span>{kw}</span>
              <button
                type="button"
                onClick={() => removeKeyword(kw)}
                className="hover:text-white p-0.5 rounded-full transition-colors"
                title={`Remove keyword "${kw}"`}
              >
                <X size={12} />
              </button>
            </span>
          ))}

          {/* Max Price */}
          {activeCriteria.maxPrice !== null && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-400">
              <DollarSign size={12} /> Max: ${activeCriteria.maxPrice.toFixed(2)}
              <button
                type="button"
                onClick={removeMaxPrice}
                className="hover:text-white p-0.5 rounded-full transition-colors"
                title="Remove max price filter"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {/* Spice Level */}
          {activeCriteria.isSpicy !== null && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-xs font-semibold text-red-400">
              <Flame size={12} /> {activeCriteria.isSpicy ? "Spicy Only 🔥" : "Mild / Non-Spicy"}
              <button
                type="button"
                onClick={removeSpiceFilter}
                className="hover:text-white p-0.5 rounded-full transition-colors"
                title="Remove spice filter"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {/* Dietary Tags */}
          {activeCriteria.dietaryTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-500/15 border border-purple-500/30 text-xs font-semibold text-purple-400"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeDietaryTag(tag)}
                className="hover:text-white p-0.5 rounded-full transition-colors"
                title={`Remove dietary tag "${tag}"`}
              >
                <X size={12} />
              </button>
            </span>
          ))}

          <button
            type="button"
            onClick={clearSearch}
            className="ml-auto text-xs text-[#94a3b8] hover:text-red-400 transition-colors"
          >
            Reset All
          </button>
        </div>
      )}

      {/* ── Search Results Section ── */}
      {loading && (
        <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-2 border-brand-accent/20 border-t-brand-accent animate-spin" />
            <Sparkles size={20} className="absolute inset-0 m-auto text-brand-accent animate-pulse" />
          </div>
          <p className="text-sm font-semibold text-[#f1f5f9]">
            Gemini AI is analyzing your craving…
          </p>
          <p className="text-xs text-[#64748b]">
            Matching ingredients, spice levels, and budget across restaurants
          </p>
        </div>
      )}

      {!loading && hasSearched && results.length === 0 && (
        <div className="mt-6 bg-brand-card border border-brand-border rounded-2xl p-8 text-center animate-fade-in">
          <div className="w-14 h-14 mx-auto rounded-full bg-brand-bg flex items-center justify-center text-[#64748b] mb-3">
            <Utensils size={28} />
          </div>
          <h3 className="text-base font-bold text-[#f1f5f9] mb-1">No Dishes Found</h3>
          <p className="text-xs text-[#94a3b8] max-w-md mx-auto mb-4">
            We couldn&apos;t find any dishes matching &ldquo;{lastSearchedQuery}&rdquo;. Try broadening your
            budget or searching for a different dish!
          </p>
          <button
            type="button"
            onClick={clearSearch}
            className="px-4 py-2 bg-brand-bg hover:bg-brand-hover border border-brand-border text-xs text-[#f1f5f9] rounded-xl transition-colors"
          >
            Clear Filters & Search Again
          </button>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-[#f1f5f9] flex items-center gap-2">
              <span>Matching Cravings ({results.length})</span>
              {aiSource && (
                <span className="text-[10px] text-[#64748b] font-normal font-mono">
                  via {aiSource}
                </span>
              )}
            </h3>
            <span className="text-xs text-[#64748b]">
              for &ldquo;{lastSearchedQuery}&rdquo;
            </span>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((dish) => {
              const isAdded = addedItemIds.has(dish._id);
              const restaurant = dish.restaurantId;

              return (
                <div
                  key={dish._id}
                  className="bg-brand-card border border-brand-border hover:border-brand-accent/50 rounded-2xl p-5 flex flex-col justify-between transition-all group hover:shadow-xl hover:shadow-brand-accent/5"
                >
                  <div>
                    {/* Header: Emoji & Restaurant info */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <span className="text-4xl group-hover:scale-110 transition-transform">
                        {dish.emoji || "🍽️"}
                      </span>
                      {restaurant && (
                        <div className="text-right">
                          <p className="text-xs font-semibold text-[#f1f5f9] flex items-center justify-end gap-1">
                            <MapPin size={11} className="text-brand-accent shrink-0" />
                            <span className="truncate max-w-[130px]">{restaurant.name}</span>
                          </p>
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <Star size={11} className="text-amber-400 fill-amber-400" />
                            <span className="text-[11px] font-bold text-amber-400">
                              {restaurant.rating ? restaurant.rating.toFixed(1) : "4.8"}
                            </span>
                            {restaurant.location && (
                              <span className="text-[10px] text-[#64748b] truncate max-w-[100px]">
                                · {restaurant.location}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Dish title & Price */}
                    <div className="flex items-baseline justify-between gap-2 mb-1.5">
                      <h4 className="font-bold text-sm text-[#f1f5f9] leading-snug group-hover:text-brand-accent transition-colors">
                        {dish.name}
                      </h4>
                      <span className="text-brand-accent font-black text-base whitespace-nowrap">
                        ${dish.price.toFixed(2)}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-[#94a3b8] line-clamp-2 mb-3">
                      {dish.description || "Freshly crafted with authentic ingredients."}
                    </p>

                    {/* Tags & Badges */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-bg border border-brand-border text-[#94a3b8]">
                        {dish.category || "Main"}
                      </span>
                      {dish.isSpicy && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-0.5">
                          <Flame size={10} /> Spicy
                        </span>
                      )}
                      {(dish.tags || []).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-accent/10 border border-brand-accent/20 text-brand-accent"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Add to cart action */}
                  <button
                    type="button"
                    onClick={() => handleAddDish(dish)}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                      isAdded
                        ? "bg-emerald-500 text-white"
                        : "bg-brand-accent hover:bg-brand-accent-h text-white shadow-brand-accent/20"
                    }`}
                  >
                    {isAdded ? (
                      "✓ Added to Cart"
                    ) : (
                      <>
                        <Plus size={14} /> Add to Cart
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
