"use client";
/**
 * @file app/restaurant/page.tsx
 * @description Restaurant kitchen dashboard — Kitchen Queue tab + Menu Management tab.
 *   - Real-time kitchen ticket queue with live timers & deduplicated order streams
 *   - Status transition controls (PREPARING -> OUT_FOR_DELIVERY -> DELIVERED)
 *   - Restaurant Cancellation Workflow with vendor-specific reasons & instant customer dispatch
 *   - Live socket sync for incoming orders and customer-initiated cancellations
 *   - Menu management (add, toggle, delete items)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ChefHat,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  XCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import api from "@/lib/api";
import { getUser, logout } from "@/lib/auth";
import { getSocket, disconnectSocket } from "@/lib/socket";
import type { Order, MenuItem, User } from "@/lib/types";
import toast from "react-hot-toast";

type Tab = "kitchen" | "menu";

interface NewItemForm {
  name: string;
  price: string;
  category: string;
  description: string;
  emoji: string;
}

const CATEGORIES = ["Burgers", "Pizza", "Sides", "Drinks", "Salads", "Desserts", "Other"];

const RESTAURANT_CANCEL_REASONS = [
  "Item(s) out of stock",
  "Kitchen too busy / Over capacity",
  "Restaurant closing soon",
  "Special request cannot be fulfilled",
  "Other",
];

export default function RestaurantPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("kitchen");
  const [isLive, setIsLive] = useState(false);

  // ── Kitchen state ────────────────────────────────────────────────
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);
  const [tickTimes, setTickTimes] = useState<Record<string, number>>({}); // orderId → startMs

  // ── Restaurant Cancellation Modal State ──────────────────────────
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState(RESTAURANT_CANCEL_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // ── Menu state ───────────────────────────────────────────────────
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState<NewItemForm>({
    name: "",
    price: "",
    category: "Burgers",
    description: "",
    emoji: "🍽️",
  });
  const [addingItem, setAddingItem] = useState(false);

  // ── Stats ────────────────────────────────────────────────────────
  const [ordersThisMin, setOrdersThisMin] = useState(0);
  const minuteCountRef = useRef(0);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  // ── Auth guard ───────────────────────────────────────────────────
  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "RESTAURANT_ADMIN") {
      toast.error(`Access denied. Restaurant Partner privileges required (logged in as ${u.role}).`);
      router.replace("/login");
      return;
    }
    setUser(u);
  }, [router]);

  // ── Timer ticker ─────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setTickTimes((p) => ({ ...p })), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Reset orders/min every 60s ───────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      minuteCountRef.current = 0;
      setOrdersThisMin(0);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ── Load data ────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const { data } = await api.get(`/api/orders?page=1&limit=30`);
      const list: Order[] = (data.orders || []).filter(
        (o: Order) => o.status !== "DELIVERED" && o.status !== "CANCELLED"
      );

      // Deduplicate orders by orderId
      const uniqueMap = new Map<string, Order>();
      list.forEach((o) => uniqueMap.set(o.orderId, o));
      const uniqueOrders = Array.from(uniqueMap.values());

      setOrders(uniqueOrders);
      const now = Date.now();
      const times: Record<string, number> = {};
      uniqueOrders.forEach((o) => {
        times[o.orderId] = new Date(o.createdAt).getTime() || now;
      });
      setTickTimes(times);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        toast.error("Session expired or unauthorized.");
        logout();
      } else {
        toast.error("Could not load orders");
      }
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const loadMenu = useCallback(async (tenantId: string) => {
    setLoadingMenu(true);
    try {
      const { data } = await api.get(`/api/menu/${tenantId}`);
      setMenuItems(data.items || []);
    } catch {
      setMenuItems([]);
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== "RESTAURANT_ADMIN" || !user.tenantId) return;
    loadOrders();
    loadMenu(user.tenantId);

    // Socket.IO
    const socket = getSocket();
    socketRef.current = socket;

    socket.on("connect", () => setIsLive(true));
    socket.on("disconnect", () => setIsLive(false));

    const seenOrdersInMinRef = new Set<string>();

    socket.on("order:new", (order: Order) => {
      const isDuplicate = seenOrdersInMinRef.has(order.orderId);
      seenOrdersInMinRef.add(order.orderId);

      setOrders((prev) => {
        if (prev.some((o) => o.orderId === order.orderId)) {
          return prev.map((o) => (o.orderId === order.orderId ? order : o));
        }
        return [order, ...prev];
      });
      setTickTimes((prev) => ({ ...prev, [order.orderId]: Date.now() }));

      if (!isDuplicate) {
        minuteCountRef.current += 1;
        setOrdersThisMin(minuteCountRef.current);
        // Play audible alert
        try {
          const ctx = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.2);
        } catch {}
        toast("🔔 New order arrived!", { icon: "📦" });
      }
    });

    socket.on("order:status-update", (data: { orderId: string; newStatus: string }) => {
      if (data.newStatus === "DELIVERED" || data.newStatus === "CANCELLED") {
        setOrders((prev) => prev.filter((o) => o.orderId !== data.orderId));
      } else {
        setOrders((prev) =>
          prev.map((o) =>
            o.orderId === data.orderId
              ? { ...o, status: data.newStatus as Order["status"] }
              : o
          )
        );
      }
    });

    socket.on(
      "order:cancelled",
      (data: { orderId: string; cancellationReason?: string; cancelledBy?: string }) => {
        setOrders((prev) => prev.filter((o) => o.orderId !== data.orderId));
        const who = data.cancelledBy === "CUSTOMER" ? "Customer" : "System / Admin";
        toast.error(
          `⚠️ Order ${data.orderId.slice(-6)} was cancelled by ${who}: ${
            data.cancellationReason || "No reason given"
          }`
        );
      }
    );

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("order:new");
      socket.off("order:status-update");
      socket.off("order:cancelled");
      disconnectSocket();
    };
  }, [user, loadOrders, loadMenu]);

  // ── Update order status ──────────────────────────────────────────
  async function updateStatus(orderId: string, status: string) {
    setUpdatingOrder(orderId);
    try {
      await api.patch(`/api/orders/${orderId}/status`, { status });
      if (status === "DELIVERED") {
        setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
        toast.success(`Order ${orderId.slice(-6)} completed and delivered! 🎉`);
      } else {
        setOrders((prev) =>
          prev.map((o) =>
            o.orderId === orderId ? { ...o, status: status as Order["status"] } : o
          )
        );
        toast.success(`Order ${orderId.slice(-6)} → ${status.replace(/_/g, " ")}`);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to update order";
      toast.error(msg);
    } finally {
      setUpdatingOrder(null);
    }
  }

  // ── Cancellation Workflow ─────────────────────────────────────────
  function openCancelModal(order: Order) {
    setOrderToCancel(order);
    setCancelReason(RESTAURANT_CANCEL_REASONS[0]);
    setCustomReason("");
    setShowCancelModal(true);
  }

  async function handleCancelOrder() {
    if (!orderToCancel) return;
    setCancelling(true);

    try {
      await api.post(`/api/orders/${orderToCancel.orderId}/cancel`, {
        reason: cancelReason,
        customReason: cancelReason === "Other" ? customReason : undefined,
      });

      setOrders((prev) => prev.filter((o) => o.orderId !== orderToCancel.orderId));
      setShowCancelModal(false);
      setOrderToCancel(null);
      toast.success("Order cancelled and customer notified.");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to cancel order";
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  }

  // ── Menu actions ─────────────────────────────────────────────────
  async function addMenuItem() {
    if (!newItem.name || !newItem.price) {
      toast.error("Name and price are required");
      return;
    }
    setAddingItem(true);
    try {
      const { data } = await api.post("/api/menu/item", {
        name: newItem.name,
        price: parseFloat(newItem.price),
        category: newItem.category,
        description: newItem.description,
        emoji: newItem.emoji,
      });
      setMenuItems(data.menu?.items || []);
      setNewItem({ name: "", price: "", category: "Burgers", description: "", emoji: "🍽️" });
      setShowAddForm(false);
      toast.success("Item added to menu!");
    } catch {
      toast.error("Failed to add item");
    } finally {
      setAddingItem(false);
    }
  }

  async function toggleItem(itemId: string) {
    try {
      const { data } = await api.post(`/api/menu/toggle/${itemId}`);
      setMenuItems((prev) =>
        prev.map((i) => (i._id === itemId ? { ...i, available: data.available } : i))
      );
    } catch {
      toast.error("Failed to toggle item");
    }
  }

  async function deleteItem(itemId: string) {
    if (!confirm("Remove this item from the menu?")) return;
    try {
      const { data } = await api.delete(`/api/menu/item/${itemId}`);
      setMenuItems(data.menu?.items || []);
      toast.success("Item removed");
    } catch {
      toast.error("Failed to remove item");
    }
  }

  function elapsedLabel(startMs: number) {
    const secs = Math.floor((Date.now() - startMs) / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  const activeOrders = orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED");

  if (!user || user.role !== "RESTAURANT_ADMIN") return null;

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar
        title={`Kitchen — ${user.tenantId}`}
        badge={isLive ? "🔴 LIVE" : "⚫ OFFLINE"}
        badgeColor={isLive ? "bg-red-500" : "bg-gray-600"}
      />

      {/* ── Stats bar ────────────────────────────────────────────── */}
      <div className="border-b border-brand-border bg-brand-card">
        <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-3 gap-4">
          {[
            { label: "Orders / Min", value: ordersThisMin, icon: "⚡" },
            { label: "Active Orders", value: activeOrders.length, icon: "🍳" },
            { label: "Menu Items", value: menuItems.length, icon: "📋" },
          ].map((stat, sIdx) => (
            <div key={`${stat.label}-${sIdx}`} className="text-center">
              <p className="text-2xl font-extrabold text-brand-accent">
                {stat.icon} {stat.value}
              </p>
              <p className="text-xs text-[#64748b] mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────── */}
      <div className="border-b border-brand-border bg-brand-card">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 pt-2">
          {([
            { id: "kitchen", label: "🍳 Kitchen Queue" },
            { id: "menu", label: "📋 Menu Management" },
          ] as { id: Tab; label: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg transition-all border-b-2 ${
                tab === t.id
                  ? "border-brand-accent text-brand-accent bg-brand-accent/10"
                  : "border-transparent text-[#94a3b8] hover:text-[#f1f5f9]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ── KITCHEN QUEUE TAB ──────────────────────────────────── */}
        {tab === "kitchen" && (
          <>
            {loadingOrders ? (
              <div className="flex justify-center py-16">
                <Loader2 size={32} className="animate-spin text-brand-accent" />
              </div>
            ) : activeOrders.length === 0 ? (
              <div className="text-center py-20 text-[#64748b]">
                <ChefHat size={56} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg font-semibold">You&apos;re all caught up! 🎉</p>
                <p className="text-sm">No active orders right now.</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeOrders.map((order, idx) => {
                  const borderColor =
                    order.status === "ORDER_RECEIVED"
                      ? "border-l-blue-500"
                      : order.status === "PREPARING"
                      ? "border-l-orange-500"
                      : "border-l-emerald-500";
                  const elapsed = tickTimes[order.orderId]
                    ? elapsedLabel(tickTimes[order.orderId])
                    : "—";
                  const isUpdating = updatingOrder === order.orderId;

                  return (
                    <div
                      key={`ticket-${order.orderId}-${idx}`}
                      className={`bg-brand-card border border-brand-border border-l-4 ${borderColor} rounded-2xl p-5 animate-slide-in flex flex-col justify-between`}
                    >
                      <div>
                        {/* Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-mono text-xs text-[#64748b] mb-1">{order.orderId}</p>
                            <StatusBadge status={order.status} />
                          </div>
                          <div className="flex items-center gap-1 text-xs text-[#94a3b8] bg-brand-bg border border-brand-border rounded-lg px-2 py-1">
                            <Clock size={11} />
                            {elapsed}
                          </div>
                        </div>

                        {/* Items checklist */}
                        <ul className="space-y-1.5 mb-4">
                          {order.items.map((item, i) => (
                            <li key={`item-${order.orderId}-${i}`} className="flex items-center gap-2 text-sm">
                              <span className="w-4 h-4 rounded border border-brand-border flex-shrink-0" />
                              <span className="text-[#f1f5f9]">{item.name}</span>
                              <span className="text-[#64748b] ml-auto">×{item.quantity}</span>
                            </li>
                          ))}
                        </ul>

                        {/* Total */}
                        <p className="text-xs text-brand-accent font-semibold mb-4">
                          Total: ${order.totalAmount.toFixed(2)}
                        </p>
                      </div>

                      {/* Action buttons */}
                      <div className="space-y-2 pt-2 border-t border-brand-border/60">
                        <div className="flex gap-2">
                          {order.status === "ORDER_RECEIVED" && (
                            <button
                              onClick={() => updateStatus(order.orderId, "PREPARING")}
                              disabled={isUpdating}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30 transition-colors disabled:opacity-50"
                            >
                              {isUpdating ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                "🍳 Mark Preparing"
                              )}
                            </button>
                          )}
                          {order.status === "PREPARING" && (
                            <button
                              onClick={() => updateStatus(order.orderId, "OUT_FOR_DELIVERY")}
                              disabled={isUpdating}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 transition-colors disabled:opacity-50"
                            >
                              {isUpdating ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                "🚴 Mark Ready"
                              )}
                            </button>
                          )}
                          {order.status === "OUT_FOR_DELIVERY" && (
                            <button
                              onClick={() => updateStatus(order.orderId, "DELIVERED")}
                              disabled={isUpdating}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors disabled:opacity-50"
                            >
                              {isUpdating ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                "✅ Complete"
                              )}
                            </button>
                          )}

                          {/* Restaurant Cancellation Button (Allowed in ORDER_RECEIVED and PREPARING) */}
                          {(order.status === "ORDER_RECEIVED" ||
                            order.status === "PREPARING") && (
                            <button
                              onClick={() => openCancelModal(order)}
                              disabled={isUpdating}
                              className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                              title="Cancel order and notify customer"
                            >
                              <XCircle size={13} />
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── MENU MANAGEMENT TAB ──────────────────────────────────── */}
        {tab === "menu" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-[#f1f5f9]">
                📋 Menu Items ({menuItems.length})
              </h2>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-accent hover:bg-brand-accent-h text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <Plus size={16} />
                Add Item
              </button>
            </div>

            {/* Add Item form */}
            {showAddForm && (
              <div className="bg-brand-card border border-brand-accent/30 rounded-2xl p-6 mb-6 animate-slide-up">
                <h3 className="font-bold text-[#f1f5f9] mb-4">New Menu Item</h3>
                <div className="grid sm:grid-cols-2 gap-4 mb-4">
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="Emoji"
                      value={newItem.emoji}
                      onChange={(e) => setNewItem({ ...newItem, emoji: e.target.value })}
                      className="w-20 bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 text-center text-xl focus:outline-none focus:border-brand-accent"
                    />
                    <input
                      type="text"
                      placeholder="Item name *"
                      value={newItem.name}
                      onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                      className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-4 py-2.5 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent"
                    />
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="number"
                      placeholder="Price *"
                      value={newItem.price}
                      min="0"
                      step="0.01"
                      onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                      className="w-28 bg-brand-bg border border-brand-border rounded-xl px-4 py-2.5 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent"
                    />
                    <select
                      value={newItem.category}
                      onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                      className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-4 py-2.5 text-sm text-[#f1f5f9] focus:outline-none focus:border-brand-accent"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <textarea
                  placeholder="Description (optional)"
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  rows={2}
                  className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-2.5 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent mb-4 resize-none"
                />
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 rounded-xl text-sm text-[#94a3b8] hover:text-[#f1f5f9] border border-brand-border"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addMenuItem}
                    disabled={addingItem}
                    className="flex items-center gap-2 px-5 py-2 bg-brand-accent hover:bg-brand-accent-h text-white text-sm font-semibold rounded-xl disabled:opacity-60"
                  >
                    {addingItem ? <Loader2 size={14} className="animate-spin" /> : null}
                    {addingItem ? "Adding…" : "Add to Menu"}
                  </button>
                </div>
              </div>
            )}

            {loadingMenu ? (
              <div className="flex justify-center py-16">
                <Loader2 size={32} className="animate-spin text-brand-accent" />
              </div>
            ) : menuItems.length === 0 ? (
              <div className="text-center py-16 text-[#64748b]">
                <p className="text-4xl mb-3">🍽️</p>
                <p>No menu items yet. Add your first item!</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {menuItems.map((item, mIdx) => (
                  <div
                    key={`menu-item-${item._id}-${mIdx}`}
                    className={`bg-brand-card border border-brand-border rounded-2xl p-4 transition-all ${
                      !item.available ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{item.emoji}</span>
                        <div>
                          <p className="font-semibold text-[#f1f5f9] text-sm">{item.name}</p>
                          <p className="text-xs text-brand-accent font-bold">
                            ${item.price.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => toggleItem(item._id)} title="Toggle availability">
                          {item.available ? (
                            <ToggleRight size={20} className="text-emerald-400" />
                          ) : (
                            <ToggleLeft size={20} className="text-[#64748b]" />
                          )}
                        </button>
                        <button onClick={() => deleteItem(item._id)} title="Delete">
                          <Trash2 size={16} className="text-red-400 hover:text-red-300" />
                        </button>
                      </div>
                    </div>
                    <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-accent/10 text-brand-accent border border-brand-accent/20 mb-2">
                      {item.category}
                    </span>
                    {item.description && (
                      <p className="text-xs text-[#64748b] line-clamp-2">{item.description}</p>
                    )}
                    {!item.available && (
                      <span className="inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                        Unavailable
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── RESTAURANT CANCELLATION MODAL ─────────────────────────── */}
      {showCancelModal && orderToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-brand-card border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-scale-up space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-brand-border pb-3">
              <div className="flex items-center gap-2 text-red-400 font-bold text-base">
                <AlertTriangle size={20} />
                Cancel Order #{orderToCancel.orderId.slice(-6)}
              </div>
              <button
                onClick={() => setShowCancelModal(false)}
                className="text-[#64748b] hover:text-[#f1f5f9] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Warning Alert */}
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300 leading-relaxed">
              Cancelling this order will immediately notify the customer, stop kitchen preparation,
              and record the action to the admin audit trail.
            </div>

            {/* Order Items Snapshot */}
            <div className="bg-brand-bg/80 border border-brand-border rounded-xl p-3 text-xs space-y-1">
              <p className="text-[#64748b] font-semibold">Order Summary:</p>
              {orderToCancel.items.map((i, idx) => (
                <div key={`modal-item-${idx}`} className="flex justify-between text-[#f1f5f9]">
                  <span>
                    {i.quantity}x {i.name}
                  </span>
                  <span className="text-[#94a3b8]">${(i.price * i.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t border-brand-border pt-1 flex justify-between font-bold text-brand-accent">
                <span>Total Amount:</span>
                <span>${orderToCancel.totalAmount.toFixed(2)}</span>
              </div>s
            </div>

            {/* Cancellation Reason Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[#f1f5f9]">
                Select Cancellation Reason: <span className="text-red-400">*</span>
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-red-500"
              >
                {RESTAURANT_CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Optional text area when 'Other' selected */}
            {cancelReason === "Other" && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#64748b]">
                  Please specify reason:
                </label>
                <textarea
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="e.g. Broken refrigeration equipment, closing early due to weather..."
                  rows={2}
                  className="w-full bg-brand-bg border border-brand-border rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-red-500 resize-none"
                />
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold border border-brand-border text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-brand-bg transition-colors"
              >
                Keep Order
              </button>
              <button
                onClick={handleCancelOrder}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-red-900/30 disabled:opacity-50"
              >
                {cancelling ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Cancelling…
                  </>
                ) : (
                  <>
                    <XCircle size={14} />
                    Confirm Cancellation
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
