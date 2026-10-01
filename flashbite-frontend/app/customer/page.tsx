"use client";
/**
 * @file app/customer/page.tsx
 * @description Customer ordering page:
 *   - Branch dropdown (fetched from /api/branches)
 *   - Live API menu catalog with category filters + search
 *   - Cart with quantity controls
 *   - Real-time order tracker via Socket.IO
 *   - End-to-end Customer Cancellation Modal & reasons workflow
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Loader2,
  Package,
  CheckCircle2,
  ChevronDown,
  XCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AiCravingSearchBar from "@/components/AiCravingSearchBar";
import api from "@/lib/api";
import { getUser } from "@/lib/auth";
import { getSocket, disconnectSocket } from "@/lib/socket";
import type { MenuItem, CartItem, Order, User } from "@/lib/types";
import toast from "react-hot-toast";

const STATUS_STEPS = ["ORDER_RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
const STEP_LABELS  = ["Order Received", "Preparing", "Out for Delivery", "Delivered"];

const CUSTOMER_CANCEL_REASONS = [
  "Changed my mind",
  "Placed order by mistake",
  "Delivery time is too long",
  "Ordered wrong items",
  "Other",
];

interface PublicBranch {
  tenantId: string;
  name: string;
  location: string;
}

export default function CustomerPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  // ── Branch selector state ────────────────────────────────────────
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<PublicBranch | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);

  // ── Menu state ───────────────────────────────────────────────────
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [restaurantInfo, setRestaurantInfo] = useState<{ name: string; location: string } | null>(null);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [addedId, setAddedId] = useState<string | null>(null);

  // ── Cart state ───────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [placing, setPlacing] = useState(false);

  // ── Order tracker state ──────────────────────────────────────────
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [orderStatus, setOrderStatus] = useState<string>("ORDER_RECEIVED");
  const [cancellationDetail, setCancellationDetail] = useState<{
    reason?: string;
    cancelledBy?: string;
    cancelledAt?: string;
  } | null>(null);
  const [stepTimes, setStepTimes] = useState<Record<string, string>>({});
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  // ── Customer Cancellation Modal State ────────────────────────────
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState(CUSTOMER_CANCEL_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // ── Auth guard ───────────────────────────────────────────────────
  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "CUSTOMER") {
      router.replace("/login");
      return;
    }
    setUser(u);
  }, [router]);

  // ── Load branch list on mount ────────────────────────────────────
  useEffect(() => {
    async function loadBranches() {
      try {
        const { data } = await api.get("/api/branches");
        setBranches(data.branches || []);
      } catch {
        toast.error("Could not load restaurant list");
      } finally {
        setLoadingBranches(false);
      }
    }
    loadBranches();
  }, []);

  // ── Socket cleanup ───────────────────────────────────────────────
  useEffect(() => () => { disconnectSocket(); }, []);

  // ── Derived filtered menu ────────────────────────────────────────
  const categories = ["All", ...Array.from(new Set(menu.map((i) => i.category)))];
  const filteredMenu = menu.filter((item) => {
    const matchCat = category === "All" || item.category === category;
    const matchSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch && item.available;
  });

  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  // ── Fetch menu for selected branch ───────────────────────────────
  const fetchMenu = useCallback(async (branch: PublicBranch) => {
    setLoadingMenu(true);
    try {
      const { data } = await api.get(`/api/menu/${branch.tenantId}`);
      setMenu(data.items || []);
      setRestaurantInfo({ name: data.restaurantName, location: data.restaurantLocation });
      setCategory("All");
      setSearch("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to load menu";
      toast.error(msg);
      setMenu([]);
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  function selectBranch(branch: PublicBranch) {
    setSelectedBranch(branch);
    setBranchMenuOpen(false);
    setCart([]);
    setCurrentOrder(null);
    setCancellationDetail(null);
    fetchMenu(branch);
  }

  // ── Cart actions ─────────────────────────────────────────────────
  function addToCart(item: MenuItem) {
    if (!selectedBranch && item.tenantId) {
      const match = branches.find((b) => b.tenantId === item.tenantId);
      if (match) {
        setSelectedBranch(match);
        setRestaurantInfo({ name: match.name, location: match.location });
      }
    }
    setCart((prev) => {
      const ex = prev.find((c) => c._id === item._id);
      if (ex) return prev.map((c) => (c._id === item._id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { ...item, quantity: 1 }];
    });
    setAddedId(item._id);
    setTimeout(() => setAddedId(null), 1500);
  }

  function updateQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c._id === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  }

  // ── Place order ──────────────────────────────────────────────────
  async function placeOrder() {
    if (!selectedBranch || cart.length === 0) return;
    setPlacing(true);
    try {
      const items = cart.map((c) => ({
        itemId: c._id,
        name: c.name,
        price: c.price,
        quantity: c.quantity,
      }));
      const { data } = await api.post("/api/orders", {
        tenantId: selectedBranch.tenantId,
        items,
      });
      const order: Order = data.order;
      setCurrentOrder(order);
      setOrderStatus("ORDER_RECEIVED");
      setCancellationDetail(null);
      setStepTimes({ ORDER_RECEIVED: new Date().toLocaleTimeString() });
      setCart([]);
      toast.success("Order placed! Tracking live 🚀");

      // Connect to Socket.IO order room
      const socket = getSocket();
      socketRef.current = socket;
      socket.emit("join:order", { orderId: order.orderId });

      socket.on(
        "order:status",
        (payload: {
          orderId: string;
          status?: string;
          newStatus?: string;
          cancellationReason?: string;
          cancelledBy?: string;
          timestamp?: string;
        }) => {
          const newStatus = payload.newStatus || payload.status || "";
          if (payload.orderId === order.orderId && newStatus) {
            setOrderStatus(newStatus);
            setStepTimes((prev) => ({
              ...prev,
              [newStatus]: new Date().toLocaleTimeString(),
            }));

            if (newStatus === "CANCELLED") {
              setCancellationDetail({
                reason: payload.cancellationReason || "Cancelled by restaurant or system",
                cancelledBy: payload.cancelledBy || "RESTAURANT_ADMIN",
                cancelledAt: payload.timestamp || new Date().toLocaleTimeString(),
              });
              toast.error(`Order was cancelled: ${payload.cancellationReason || "No reason specified"}`);
            } else if (newStatus === "DELIVERED") {
              toast.success("🎉 Your order has been delivered!");
            }
          }
        }
      );
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to place order";
      toast.error(msg);
    } finally {
      setPlacing(false);
    }
  }

  // ── Cancel Order Handler ─────────────────────────────────────────
  async function handleCancelOrder() {
    if (!currentOrder) return;
    setCancelling(true);

    try {
      const { data } = await api.post(`/api/orders/${currentOrder.orderId}/cancel`, {
        reason: selectedReason,
        customReason: selectedReason === "Other" ? customReason : undefined,
      });

      const updatedOrder: Order = data.order;
      setOrderStatus("CANCELLED");
      setCancellationDetail({
        reason: updatedOrder.cancellationReason || selectedReason,
        cancelledBy: "CUSTOMER",
        cancelledAt: updatedOrder.cancelledAt || new Date().toLocaleTimeString(),
      });
      setShowCancelModal(false);
      toast.success("Your order has been cancelled.");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to cancel order";
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  }

  if (!user) return null;

  const currentStepIndex = STATUS_STEPS.indexOf(orderStatus);

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar
        title={`Hello, ${user.name}! 👋`}
        rightSlot={
          <div className="flex items-center gap-2">
            {cartCount > 0 && (
              <span className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-accent/20 border border-brand-accent/40 text-brand-accent text-sm font-semibold">
                <ShoppingCart size={14} />
                {cartCount} items · ${cartTotal.toFixed(2)}
              </span>
            )}
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* ── AI Craving Search Bar ───────────────────────────────── */}
        <AiCravingSearchBar onAddToCart={addToCart} className="mb-8" />

        {/* ── Branch Selector ──────────────────────────────────────── */}
        <div className="bg-brand-card border border-brand-border rounded-2xl p-6 mb-8">
          <h2 className="text-base font-bold mb-1 text-[#f1f5f9]">🏪 Choose a Restaurant</h2>
          <p className="text-xs text-[#64748b] mb-4">Select a branch to browse their live menu.</p>

          {loadingBranches ? (
            <div className="flex items-center gap-2 text-[#64748b] text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading restaurants…
            </div>
          ) : branches.length === 0 ? (
            <p className="text-[#64748b] text-sm">No active restaurants found.</p>
          ) : (
            <div className="relative max-w-md">
              <button
                type="button"
                onClick={() => setBranchMenuOpen((prev) => !prev)}
                className="w-full flex items-center justify-between bg-brand-bg border border-brand-border hover:border-brand-accent rounded-xl px-4 py-3 text-left transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-[#f1f5f9]">
                    {selectedBranch ? selectedBranch.name : "Select a restaurant branch…"}
                  </p>
                  {selectedBranch && (
                    <p className="text-xs text-[#94a3b8]">{selectedBranch.location}</p>
                  )}
                </div>
                <ChevronDown
                  size={18}
                  className={`text-[#94a3b8] transition-transform ${branchMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {branchMenuOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-brand-card border border-brand-border rounded-xl shadow-2xl z-30 overflow-hidden">
                  {branches.map((b) => (
                    <button
                      key={b.tenantId}
                      type="button"
                      onClick={() => selectBranch(b)}
                      className="w-full px-4 py-3 text-left hover:bg-brand-bg transition-colors border-b border-brand-border/40 last:border-0"
                    >
                      <p className="text-sm font-semibold text-[#f1f5f9]">{b.name}</p>
                      <p className="text-xs text-[#94a3b8]">{b.location}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Main Layout: Menu Catalog (Left) + Cart & Tracker (Right) */}
        {selectedBranch && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-8">
            {/* ── LEFT: Menu Catalog ──────────────────────────────── */}
            <div>
              {/* Restaurant Header */}
              {restaurantInfo && (
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-black text-[#f1f5f9]">{restaurantInfo.name}</h1>
                    <p className="text-xs text-[#94a3b8]">{restaurantInfo.location}</p>
                  </div>

                  {/* Search */}
                  <div className="relative w-full sm:w-64">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748b]" />
                    <input
                      type="text"
                      placeholder="Search menu items…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-brand-card border border-brand-border rounded-xl pl-9 pr-4 py-2 text-xs text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Category Filter Pills */}
              {categories.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-none">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                        category === cat
                          ? "bg-brand-accent text-white shadow-md shadow-brand-accent/20"
                          : "bg-brand-card border border-brand-border text-[#94a3b8] hover:text-[#f1f5f9]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {/* Menu Grid */}
              {loadingMenu ? (
                <div className="flex items-center justify-center py-20 text-[#64748b]">
                  <Loader2 size={24} className="animate-spin mr-2" /> Loading menu…
                </div>
              ) : menu.length === 0 ? (
                <div className="text-center py-16 text-[#64748b] bg-brand-card border border-brand-border rounded-2xl p-8">
                  <Package size={40} className="mx-auto mb-2 opacity-40" />
                  <p>This restaurant hasn&apos;t set up their menu yet.</p>
                </div>
              ) : filteredMenu.length === 0 ? (
                <div className="text-center py-10 text-[#64748b]">
                  <p>No items match your search.</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {filteredMenu.map((item) => (
                    <div
                      key={item._id}
                      className="bg-brand-card border border-brand-border rounded-2xl p-5 hover:border-brand-border-l transition-all"
                    >
                      <div className="text-4xl mb-3">{item.emoji}</div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-bold text-[#f1f5f9] leading-tight">{item.name}</h3>
                        <span className="text-brand-accent font-extrabold text-base whitespace-nowrap">
                          ${item.price.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-[#94a3b8] line-clamp-2 mb-4">{item.description}</p>
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-accent/10 text-brand-accent border border-brand-accent/20 mb-3">
                        {item.category}
                      </span>
                      <button
                        onClick={() => addToCart(item)}
                        className={`w-full py-2 rounded-xl text-sm font-semibold transition-all ${
                          addedId === item._id
                            ? "bg-emerald-500 text-white"
                            : "bg-brand-accent hover:bg-brand-accent-h text-white"
                        }`}
                      >
                        {addedId === item._id ? "✓ Added!" : "Add to Cart"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── RIGHT: Cart + Order Tracker ─────────────────────── */}
            <div className="space-y-5">
              {/* Cart */}
              <div className="bg-brand-card border border-brand-border rounded-2xl p-5 sticky top-20">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-[#f1f5f9]">🛒 Cart</h3>
                  {cartCount > 0 && (
                    <span className="text-xs bg-brand-accent/20 text-brand-accent px-2 py-0.5 rounded-full font-semibold">
                      {cartCount} items
                    </span>
                  )}
                </div>

                {cart.length === 0 ? (
                  <p className="text-[#64748b] text-sm text-center py-6">
                    Your cart is empty. Add some items!
                  </p>
                ) : (
                  <div className="space-y-3 mb-4 max-h-56 overflow-y-auto pr-1">
                    {cart.map((item) => (
                      <div key={item._id} className="flex items-center gap-3">
                        <span className="text-xl">{item.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#f1f5f9] truncate">{item.name}</p>
                          <p className="text-xs text-brand-accent">
                            ${(item.price * item.quantity).toFixed(2)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => updateQty(item._id, -1)}
                            className="w-6 h-6 rounded-full bg-brand-bg border border-brand-border flex items-center justify-center hover:border-brand-accent transition-colors"
                          >
                            <Minus size={10} />
                          </button>
                          <span className="text-sm font-bold w-5 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQty(item._id, 1)}
                            className="w-6 h-6 rounded-full bg-brand-bg border border-brand-border flex items-center justify-center hover:border-brand-accent transition-colors"
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cart.length > 0 && (
                  <>
                    <div className="border-t border-brand-border pt-3 mb-4 flex items-center justify-between">
                      <span className="text-sm text-[#94a3b8]">Total</span>
                      <span className="text-xl font-extrabold text-brand-accent">
                        ${cartTotal.toFixed(2)}
                      </span>
                    </div>
                    <button
                      onClick={placeOrder}
                      disabled={placing}
                      className="w-full flex items-center justify-center gap-2 bg-brand-accent hover:bg-brand-accent-h text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-60"
                    >
                      {placing ? <Loader2 size={16} className="animate-spin" /> : null}
                      {placing ? "Placing Order…" : "🚀 Place Order"}
                    </button>
                  </>
                )}
              </div>

              {/* Order Tracker */}
              {currentOrder && (
                <div className="bg-brand-card border border-brand-border rounded-2xl p-5 animate-slide-in">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="font-bold text-[#f1f5f9]">📦 Order Tracker</h3>
                    <span className="text-[10px] font-mono bg-brand-bg border border-brand-border px-2 py-0.5 rounded-md text-[#94a3b8]">
                      {currentOrder.orderId}
                    </span>
                  </div>

                  {/* ── CANCELLED STATE BANNER ── */}
                  {orderStatus === "CANCELLED" ? (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center space-y-2 animate-fade-in">
                      <div className="w-10 h-10 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
                        <XCircle size={24} />
                      </div>
                      <h4 className="text-base font-bold text-red-400">Order Cancelled</h4>
                      <p className="text-xs text-[#94a3b8]">
                        {cancellationDetail?.cancelledBy === "CUSTOMER"
                          ? "You cancelled this order."
                          : "This order was cancelled by the restaurant."}
                      </p>
                      {cancellationDetail?.reason && (
                        <div className="bg-brand-bg/80 rounded-lg p-2.5 text-xs border border-brand-border text-left">
                          <p className="text-[11px] text-[#64748b] font-medium">Reason:</p>
                          <p className="text-[#f1f5f9] font-medium mt-0.5">{cancellationDetail.reason}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── 4-STEP LIVE TIMELINE ── */
                    <div className="space-y-1">
                      {STATUS_STEPS.map((step, idx) => {
                        const isDone = idx < currentStepIndex;
                        const isCurrent = idx === currentStepIndex;
                        const isDelivered = step === "DELIVERED" && orderStatus === "DELIVERED";

                        return (
                          <div key={step} className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                                  isDone || isDelivered
                                    ? "bg-emerald-500 text-white"
                                    : isCurrent
                                    ? "bg-brand-accent text-white ring-4 ring-brand-accent/20"
                                    : "bg-brand-card border-2 border-brand-border text-[#64748b]"
                                }`}
                              >
                                {isDone || isDelivered ? <CheckCircle2 size={16} /> : idx + 1}
                              </div>
                              {idx < STATUS_STEPS.length - 1 && (
                                <div
                                  className={`w-0.5 h-8 mt-1 transition-all ${
                                    isDone ? "bg-emerald-500" : "bg-brand-border"
                                  }`}
                                />
                              )}
                            </div>
                            <div className="pt-1.5 pb-3 flex-1">
                              <p
                                className={`text-sm font-semibold ${
                                  isDelivered
                                    ? "text-emerald-400"
                                    : isCurrent
                                    ? "text-brand-accent"
                                    : isDone
                                    ? "text-emerald-400"
                                    : "text-[#64748b]"
                                }`}
                              >
                                {STEP_LABELS[idx]}
                              </p>
                              {stepTimes[step] && (
                                <p className="text-xs text-[#64748b]">{stepTimes[step]}</p>
                              )}
                              {isCurrent && step !== "DELIVERED" && (
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse-dot" />
                                  <span className="text-xs text-brand-accent">In progress</span>
                                </div>
                              )}
                              {isDelivered && (
                                <p className="text-xs text-emerald-400 mt-1">✓ Completed</p>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Customer Cancel Button (Only in ORDER_RECEIVED state) */}
                      {orderStatus === "ORDER_RECEIVED" && (
                        <div className="pt-4 border-t border-brand-border mt-3">
                          <button
                            type="button"
                            onClick={() => setShowCancelModal(true)}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors"
                          >
                            <XCircle size={14} /> Cancel Order
                          </button>
                          <p className="text-[10px] text-[#64748b] text-center mt-1.5">
                            Cancellations allowed before kitchen preparation starts.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Landing state ────────────────────────────────────────── */}
        {!selectedBranch && !loadingMenu && !loadingBranches && (
          <div className="text-center py-20 text-[#64748b]">
            <Package size={56} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-semibold mb-1">Select a restaurant above to get started</p>
            <p className="text-sm">{branches.length} branches available</p>
          </div>
        )}
      </div>

      {/* ── Customer Cancellation Modal ─────────────────────────────── */}
      {showCancelModal && currentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-brand-card border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button
              onClick={() => setShowCancelModal(false)}
              className="absolute top-4 right-4 text-[#94a3b8] hover:text-white transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#f1f5f9]">Cancel Your Order</h3>
                <p className="text-xs text-[#94a3b8] font-mono">{currentOrder.orderId}</p>
              </div>
            </div>

            <p className="text-xs text-[#94a3b8] mb-4">
              Please let us know why you are cancelling this order. This helps us improve our service.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#f1f5f9] mb-1.5">
                  Cancellation Reason <span className="text-red-400">*</span>
                </label>
                <select
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-brand-accent transition-colors"
                >
                  {CUSTOMER_CANCEL_REASONS.map((r) => (
                    <option key={r} value={r} className="bg-brand-card text-[#f1f5f9]">
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {selectedReason === "Other" && (
                <div>
                  <label className="block text-xs font-medium text-[#94a3b8] mb-1">
                    Please describe the reason:
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter custom reason…"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full bg-brand-bg border border-brand-border rounded-xl p-3 text-xs text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent transition-colors"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 rounded-xl border border-brand-border text-xs text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleCancelOrder}
                disabled={cancelling}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-60"
              >
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : null}
                {cancelling ? "Cancelling…" : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
