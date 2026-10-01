"use client";
/**
 * @file app/admin/page.tsx
 * @description Super Admin dashboard:
 *   - Operations tab: Metrics (Today / Week / Month / Active), Branch Overview, Live New Orders Stream, Event Terminal
 *   - Cancellation Analytics & Audit tab: Total Cancelled, Rate (%), Breakdown by Actor, Breakdown by Reason, Top Cancelled Branches, and Audit Trail Log Table
 *   - Real-time telemetry logging (Kafka / Redis / Socket / Audit)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  Copy,
  Check,
  ShieldAlert,
  Activity,
  AlertTriangle,
  UserCheck,
  Building2,
  Filter,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import api from "@/lib/api";
import { getUser, logout } from "@/lib/auth";
import { getSocket, disconnectSocket } from "@/lib/socket";
import type {
  Branch,
  StreamEvent,
  TerminalLog,
  User,
  CancellationAnalytics,
} from "@/lib/types";
import toast from "react-hot-toast";

type AdminTab = "operations" | "cancellations";

const TAG_COLORS: Record<string, string> = {
  "[KAFKA]": "text-orange-400",
  "[REDIS]": "text-emerald-400",
  "[SOCKET]": "text-blue-400",
  "[ERROR]": "text-red-400",
  "[INFO]": "text-[#94a3b8]",
  "[AUDIT]": "text-rose-400 font-bold",
};

interface Metrics {
  today: number;
  week: number;
  month: number;
  active: number;
  cancelled?: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<AdminTab>("operations");

  // ── Operations State ─────────────────────────────────────────────
  const [branches, setBranches] = useState<Branch[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({
    today: 0,
    week: 0,
    month: 0,
    active: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [orderStream, setOrderStream] = useState<StreamEvent[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);

  // ── Cancellation Analytics State ─────────────────────────────────
  const [cancellationData, setCancellationData] = useState<CancellationAnalytics | null>(null);
  const [loadingCancellations, setLoadingCancellations] = useState(false);
  const [auditFilterActor, setAuditFilterActor] = useState<string>("ALL");

  // ── Auth guard ───────────────────────────────────────────────────
  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "SUPER_ADMIN") {
      toast.error(`Access denied. Super Admin privileges required (logged in as ${u.role}).`);
      router.replace("/login");
      return;
    }
    setUser(u);
  }, [router]);

  // ── Live clock ───────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch Operations Data ────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const u = getUser();
    if (!u || u.role !== "SUPER_ADMIN") return;

    setLoading(true);
    try {
      const [branchRes, metricsRes] = await Promise.all([
        api.get("/api/admin/branches"),
        api.get("/api/admin/metrics"),
      ]);
      setBranches(branchRes.data || []);
      setMetrics(metricsRes.data || { today: 0, week: 0, month: 0, active: 0, cancelled: 0 });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403 || status === 401) {
        toast.error("Session expired or unauthorized. Please log in as Super Admin.");
        logout();
      } else {
        toast.error("Failed to load dashboard data");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch Cancellation Analytics ─────────────────────────────────
  const fetchCancellations = useCallback(async () => {
    const u = getUser();
    if (!u || u.role !== "SUPER_ADMIN") return;

    setLoadingCancellations(true);
    try {
      const { data } = await api.get("/api/admin/cancellations");
      setCancellationData(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 403 && status !== 401) {
        toast.error("Failed to load cancellation analytics");
      }
    } finally {
      setLoadingCancellations(false);
    }
  }, []);

  // Fetch only when user is established as SUPER_ADMIN
  useEffect(() => {
    if (user && user.role === "SUPER_ADMIN") {
      fetchData();
      fetchCancellations();
    }
  }, [user, fetchData, fetchCancellations]);

  // ── Auto-refresh every 30s ───────────────────────────────────────
  useEffect(() => {
    if (!user || user.role !== "SUPER_ADMIN") return;
    const id = setInterval(() => {
      fetchData();
      fetchCancellations();
    }, 30000);
    return () => clearInterval(id);
  }, [user, fetchData, fetchCancellations]);

  // ── Append Log to Terminal ───────────────────────────────────────
  const appendLog = useCallback((log: TerminalLog) => {
    setTerminalLogs((prev) => {
      const next = [...prev, log].slice(-200);
      setTimeout(() => {
        if (terminalRef.current) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
      }, 50);
      return next;
    });
  }, []);

  // ── Socket.IO ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || user.role !== "SUPER_ADMIN") return;

    const socket = getSocket();

    socket.on(
      "admin:order-stream",
      (data: {
        type?: string;
        orderId: string;
        tenantId: string;
        status?: string;
        newStatus?: string;
        cancellationReason?: string;
        cancelledBy?: string;
        timestamp: string;
      }) => {
        const eventType = data.type || "order-updated";

        if (eventType === "order-created") {
          const event: StreamEvent = {
            id: `${data.orderId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            type: "order-created",
            orderId: data.orderId,
            tenantId: data.tenantId,
            status: data.status || "ORDER_RECEIVED",
            timestamp: new Date().toLocaleTimeString(),
          };
          setOrderStream((prev) => [event, ...prev.filter((e) => e.orderId !== data.orderId)].slice(0, 50));
          fetchData();
        } else if (eventType === "order-cancelled") {
          fetchData();
          fetchCancellations();
        }

        const logMessage =
          eventType === "order-cancelled"
            ? `ORDER_CANCELLED | Order ${data.orderId} | Branch ${data.tenantId} | Actor: ${
                data.cancelledBy || "UNKNOWN"
              } | Reason: "${data.cancellationReason || "None"}"`
            : `${eventType} | Order ${data.orderId} | Branch ${data.tenantId}${
                data.newStatus ? ` → ${data.newStatus}` : ""
              }`;

        appendLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tag: eventType === "order-cancelled" ? "[AUDIT]" : "[SOCKET]",
          message: logMessage,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    );

    socket.on(
      "admin:telemetry-log",
      (log: { type: string; message: string; timestamp: string }) => {
        appendLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tag: (log.type as TerminalLog["tag"]) || "[INFO]",
          message: log.message,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    );

    return () => {
      socket.off("admin:order-stream");
      socket.off("admin:telemetry-log");
      disconnectSocket();
    };
  }, [user, fetchData, fetchCancellations, appendLog]);

  function copyTenant(id: string) {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast.success("Copied to clipboard!");
    });
  }

  // ── Derived stats ────────────────────────────────────────────────
  const totalBranches = branches.length;
  const activeBranches = branches.filter((b) => b.isActive).length;

  const filteredAuditLogs =
    cancellationData?.auditLogs.filter((log) => {
      if (auditFilterActor === "ALL") return true;
      return log.cancelledBy === auditFilterActor;
    }) || [];

  if (!user || user.role !== "SUPER_ADMIN") return null;

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar
        title="Admin Control Center"
        badge="SUPER ADMIN"
        badgeColor="bg-red-600"
        rightSlot={<span className="font-mono text-xs text-[#64748b]">{clock}</span>}
      />

      {/* ── Top Level Tab Bar ────────────────────────────────────────── */}
      <div className="border-b border-brand-border bg-brand-card">
        <div className="max-w-7xl mx-auto px-4 flex gap-2 pt-2">
          <button
            onClick={() => setTab("operations")}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition-all border-b-2 ${
              tab === "operations"
                ? "border-brand-accent text-brand-accent bg-brand-accent/10"
                : "border-transparent text-[#94a3b8] hover:text-[#f1f5f9]"
            }`}
          >
            <Activity size={16} />
            Platform Operations & Live Stream
          </button>
          <button
            onClick={() => {
              setTab("cancellations");
              fetchCancellations();
            }}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition-all border-b-2 ${
              tab === "cancellations"
                ? "border-rose-500 text-rose-400 bg-rose-500/10"
                : "border-transparent text-[#94a3b8] hover:text-[#f1f5f9]"
            }`}
          >
            <ShieldAlert size={16} />
            Cancellation Intelligence & Audit Trail
            {cancellationData && cancellationData.totalCancelled > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs font-bold rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                {cancellationData.totalCancelled}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── TAB 1: OPERATIONS & LIVE STREAM ───────────────────────── */}
        {tab === "operations" && (
          <>
            {/* ── Row 1: KPI Cards ───────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { icon: "🏪", label: "Branches", value: totalBranches, color: "text-[#f1f5f9]" },
                {
                  icon: "⚡",
                  label: "Active Branches",
                  value: activeBranches,
                  color: "text-emerald-400",
                },
                {
                  icon: "🟡",
                  label: "Active Orders",
                  value: metrics.active,
                  color: "text-yellow-400",
                },
                {
                  icon: "📅",
                  label: "Orders Today",
                  value: metrics.today,
                  color: "text-brand-accent",
                },
                { icon: "📆", label: "This Week", value: metrics.week, color: "text-blue-400" },
                {
                  icon: "🚫",
                  label: "Cancelled",
                  value: metrics.cancelled ?? cancellationData?.totalCancelled ?? 0,
                  color: "text-rose-400",
                },
              ].map((kpi, idx) => (
                <div
                  key={`${kpi.label}-${idx}`}
                  className="bg-brand-card border border-brand-border rounded-2xl p-4 text-center"
                >
                  <p className="text-xl mb-1">{kpi.icon}</p>
                  <p className={`text-2xl font-extrabold ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-[10px] text-[#64748b] mt-1 leading-tight">{kpi.label}</p>
                </div>
              ))}
            </div>

            {/* ── Row 2: Two-column ──────────────────────────────────── */}
            <div className="grid lg:grid-cols-[1fr_360px] gap-6">
              {/* Branch table */}
              <div className="bg-brand-card border border-brand-border rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
                  <h2 className="font-bold text-[#f1f5f9]">🏪 Branch Overview</h2>
                  <button
                    onClick={fetchData}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
                  >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    Refresh
                  </button>
                </div>

                {loading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 size={28} className="animate-spin text-brand-accent" />
                  </div>
                ) : branches.length === 0 ? (
                  <p className="text-center py-12 text-[#64748b]">No branches registered yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-brand-border">
                          {[
                            "Branch",
                            "Tenant ID",
                            "Location",
                            "Status",
                            "All-Time",
                            "Active Orders",
                          ].map((h) => (
                            <th
                              key={h}
                              className="text-left text-xs font-semibold text-[#64748b] px-4 py-3"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((branch, branchIdx) => (
                          <tr
                            key={`${branch.tenantId}-${branchIdx}`}
                            className="border-b border-brand-border hover:bg-[#243147] transition-colors"
                          >
                            <td className="px-4 py-3 font-semibold text-[#f1f5f9]">{branch.name}</td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => copyTenant(branch.tenantId)}
                                className="flex items-center gap-1.5 font-mono text-xs text-[#94a3b8] hover:text-brand-accent transition-colors"
                              >
                                {branch.tenantId}
                                {copiedId === branch.tenantId ? (
                                  <Check size={11} className="text-emerald-400" />
                                ) : (
                                  <Copy size={11} />
                                )}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-[#94a3b8]">{branch.location}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  branch.isActive
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    branch.isActive ? "bg-emerald-400" : "bg-red-400"
                                  }`}
                                />
                                {branch.isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[#94a3b8]">{branch.totalOrdersCount}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`font-bold ${
                                  (branch.activeOrdersCount ?? 0) > 0
                                    ? "text-yellow-400"
                                    : "text-[#64748b]"
                                }`}
                              >
                                {branch.activeOrdersCount ?? 0}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Live new orders stream */}
              <div className="bg-brand-card border border-brand-border rounded-2xl overflow-hidden flex flex-col">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-brand-border">
                  <h2 className="font-bold text-[#f1f5f9]">📡 New Orders Stream</h2>
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse-dot" />
                    LIVE
                  </span>
                </div>
                <p className="px-5 py-2 text-[10px] text-[#64748b] border-b border-brand-border">
                  Shows new incoming orders — live status updates appear in the Event Terminal
                  below.
                </p>

                <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-brand-border">
                  {orderStream.length === 0 ? (
                    <p className="text-center py-10 text-[#64748b] text-sm">Waiting for new orders…</p>
                  ) : (
                    orderStream.map((event, eventIdx) => (
                      <div
                        key={`${event.id}-${eventIdx}`}
                        className="flex items-start gap-3 px-4 py-3 border-l-2 border-l-orange-500 animate-slide-in"
                      >
                        <span className="font-mono text-[10px] text-[#64748b] shrink-0 mt-0.5">
                          {event.timestamp}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs text-brand-accent font-semibold truncate">
                              {event.tenantId}
                            </span>
                            <StatusBadge status={event.status} />
                          </div>
                          <p className="font-mono text-[10px] text-[#64748b] truncate">
                            {event.orderId}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ── Event Terminal ──────────────────────────────────────── */}
            <div className="bg-brand-card border border-brand-border rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
                <div>
                  <h2 className="font-bold text-[#f1f5f9]">💻 Event Terminal</h2>
                  <p className="text-[10px] text-[#64748b] mt-0.5">
                    Kafka · Redis · Socket.IO · Cancellation Audit telemetry logs
                  </p>
                </div>
                <button
                  onClick={() => setTerminalLogs([])}
                  className="text-xs text-[#64748b] hover:text-[#f1f5f9] transition-colors"
                >
                  Clear
                </button>
              </div>
              <div ref={terminalRef} className="terminal">
                {terminalLogs.length === 0 ? (
                  <span className="text-[#64748b]">Waiting for events…</span>
                ) : (
                  terminalLogs.map((log, logIdx) => (
                    <div key={`${log.id}-${logIdx}`} className="flex gap-2 mb-0.5">
                      <span className="text-[#64748b] shrink-0">[{log.timestamp}]</span>
                      <span
                        className={`font-semibold shrink-0 ${
                          TAG_COLORS[log.tag] || "text-[#94a3b8]"
                        }`}
                      >
                        {log.tag}
                      </span>
                      <span className="text-[#94a3b8]">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* ── TAB 2: CANCELLATION INTELLIGENCE & AUDIT TRAIL ─────────── */}
        {tab === "cancellations" && (
          <div className="space-y-6">
            {/* Header / Refresh */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#f1f5f9] flex items-center gap-2">
                  <ShieldAlert className="text-rose-400" />
                  Cancellation Metrics & Audit Logs
                </h2>
                <p className="text-xs text-[#64748b] mt-1">
                  Comprehensive audit trail tracking reasons, initiator actors, and branch risk
                  metrics.
                </p>
              </div>
              <button
                onClick={fetchCancellations}
                disabled={loadingCancellations}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-card border border-brand-border text-xs font-semibold text-[#f1f5f9] rounded-xl hover:bg-brand-card-hover transition-colors"
              >
                <RefreshCw size={13} className={loadingCancellations ? "animate-spin" : ""} />
                Refresh Audit Data
              </button>
            </div>

            {loadingCancellations && !cancellationData ? (
              <div className="flex justify-center py-20">
                <Loader2 size={36} className="animate-spin text-rose-500" />
              </div>
            ) : cancellationData ? (
              <>
                {/* ── KPI Cards ─────────────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-brand-card border border-brand-border rounded-2xl p-5">
                    <p className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">
                      Total Orders Placed
                    </p>
                    <p className="text-3xl font-black text-[#f1f5f9] mt-2">
                      {cancellationData.totalOrders}
                    </p>
                    <p className="text-[11px] text-[#94a3b8] mt-1">Across all branches</p>
                  </div>

                  <div className="bg-brand-card border border-rose-500/30 rounded-2xl p-5">
                    <p className="text-xs text-rose-400 font-semibold uppercase tracking-wider">
                      Total Cancelled
                    </p>
                    <p className="text-3xl font-black text-rose-400 mt-2">
                      {cancellationData.totalCancelled}
                    </p>
                    <p className="text-[11px] text-rose-300/70 mt-1">
                      Platform cancellation volume
                    </p>
                  </div>

                  <div className="bg-brand-card border border-brand-border rounded-2xl p-5">
                    <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider">
                      Cancellation Rate
                    </p>
                    <p className="text-3xl font-black text-yellow-400 mt-2">
                      {cancellationData.cancellationRate}
                    </p>
                    <p className="text-[11px] text-[#94a3b8] mt-1">Of total order throughput</p>
                  </div>

                  <div className="bg-brand-card border border-brand-border rounded-2xl p-5">
                    <p className="text-xs text-purple-400 font-semibold uppercase tracking-wider">
                      Primary Cancellation Cause
                    </p>
                    <p className="text-lg font-bold text-purple-300 mt-2 truncate">
                      {cancellationData.byReason[0]?.reason || "No Cancellations"}
                    </p>
                    <p className="text-[11px] text-[#94a3b8] mt-1">
                      {cancellationData.byReason[0]
                        ? `${cancellationData.byReason[0].percentage} of cancellations`
                        : "Clean record"}
                    </p>
                  </div>
                </div>

                {/* ── Actor Breakdown & Reason Breakdown ─────────────── */}
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Actor Breakdown */}
                  <div className="bg-brand-card border border-brand-border rounded-2xl p-5">
                    <h3 className="font-bold text-[#f1f5f9] text-sm mb-4 flex items-center gap-2">
                      <UserCheck size={16} className="text-brand-accent" />
                      Cancellations by Actor
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-brand-bg/80 border border-brand-border rounded-xl p-3 text-center">
                        <p className="text-2xl font-black text-blue-400">
                          {cancellationData.byActor.CUSTOMER}
                        </p>
                        <p className="text-xs font-semibold text-[#f1f5f9] mt-1">👤 Customer</p>
                        <p className="text-[10px] text-[#64748b]">Before prep starts</p>
                      </div>

                      <div className="bg-brand-bg/80 border border-brand-border rounded-xl p-3 text-center">
                        <p className="text-2xl font-black text-orange-400">
                          {cancellationData.byActor.RESTAURANT_ADMIN}
                        </p>
                        <p className="text-xs font-semibold text-[#f1f5f9] mt-1">🍳 Kitchen</p>
                        <p className="text-[10px] text-[#64748b]">Stock / capacity</p>
                      </div>

                      <div className="bg-brand-bg/80 border border-brand-border rounded-xl p-3 text-center">
                        <p className="text-2xl font-black text-red-400">
                          {cancellationData.byActor.SUPER_ADMIN}
                        </p>
                        <p className="text-xs font-semibold text-[#f1f5f9] mt-1">🛡️ Admin</p>
                        <p className="text-[10px] text-[#64748b]">Intervention</p>
                      </div>
                    </div>
                  </div>

                  {/* Reason Distribution */}
                  <div className="bg-brand-card border border-brand-border rounded-2xl p-5">
                    <h3 className="font-bold text-[#f1f5f9] text-sm mb-4 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-yellow-400" />
                      Reason Breakdown
                    </h3>
                    {cancellationData.byReason.length === 0 ? (
                      <p className="text-xs text-[#64748b] py-6 text-center">
                        No cancellation reasons logged.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {cancellationData.byReason.map((r, i) => (
                          <div key={`${r.reason}-${i}`} className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-[#f1f5f9] font-medium">{r.reason}</span>
                              <span className="text-[#94a3b8] font-mono font-semibold">
                                {r.count} ({r.percentage})
                              </span>
                            </div>
                            <div className="w-full bg-brand-bg h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-rose-500 h-full rounded-full transition-all"
                                style={{ width: r.percentage }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Top Cancelled Branches Table ──────────────────── */}
                <div className="bg-brand-card border border-brand-border rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between">
                    <h3 className="font-bold text-[#f1f5f9] text-sm flex items-center gap-2">
                      <Building2 size={16} className="text-purple-400" />
                      Branch Cancellation Performance
                    </h3>
                  </div>
                  {cancellationData.topRestaurants.length === 0 ? (
                    <p className="text-xs text-[#64748b] p-6 text-center">
                      No branch cancellation data recorded.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-brand-border text-[#64748b]">
                            <th className="text-left px-4 py-3 font-semibold">Branch Name</th>
                            <th className="text-left px-4 py-3 font-semibold">Tenant ID</th>
                            <th className="text-left px-4 py-3 font-semibold">Location</th>
                            <th className="text-right px-4 py-3 font-semibold">Cancelled</th>
                            <th className="text-right px-4 py-3 font-semibold">Total Orders</th>
                            <th className="text-right px-4 py-3 font-semibold">
                              Cancellation Rate
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-border">
                          {cancellationData.topRestaurants.map((res, resIdx) => (
                            <tr key={`${res.tenantId}-${resIdx}`} className="hover:bg-[#243147] transition-colors">
                              <td className="px-4 py-3 font-semibold text-[#f1f5f9]">{res.name}</td>
                              <td className="px-4 py-3 font-mono text-[#94a3b8]">{res.tenantId}</td>
                              <td className="px-4 py-3 text-[#94a3b8]">{res.location}</td>
                              <td className="px-4 py-3 text-right font-bold text-rose-400">
                                {res.cancelledCount}
                              </td>
                              <td className="px-4 py-3 text-right text-[#94a3b8]">
                                {res.totalBranchOrders}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-yellow-400">
                                {res.rate}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Cancellation Audit Trail Log Table ─────────────── */}
                <div className="bg-brand-card border border-brand-border rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-brand-border flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-[#f1f5f9] text-sm flex items-center gap-2">
                        <ShieldAlert size={16} className="text-rose-400" />
                        Live Audit Trail Feed
                      </h3>
                      <p className="text-[10px] text-[#64748b] mt-0.5">
                        Immutable event log of every cancelled order with reason and actor context
                      </p>
                    </div>

                    {/* Filter by Actor */}
                    <div className="flex items-center gap-2">
                      <Filter size={13} className="text-[#64748b]" />
                      <span className="text-xs text-[#94a3b8]">Actor:</span>
                      <select
                        value={auditFilterActor}
                        onChange={(e) => setAuditFilterActor(e.target.value)}
                        className="bg-brand-bg border border-brand-border rounded-lg px-2.5 py-1 text-xs text-[#f1f5f9] focus:outline-none focus:border-brand-accent"
                      >
                        <option value="ALL">All Initiators</option>
                        <option value="CUSTOMER">Customer</option>
                        <option value="RESTAURANT_ADMIN">Restaurant / Kitchen</option>
                        <option value="SUPER_ADMIN">Super Admin</option>
                      </select>
                    </div>
                  </div>

                  {filteredAuditLogs.length === 0 ? (
                    <div className="p-10 text-center text-[#64748b]">
                      <p className="text-sm">No cancellation audit records found for this filter.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-brand-card border-b border-brand-border text-[#64748b] shadow-sm">
                          <tr>
                            <th className="text-left px-4 py-3 font-semibold">Timestamp</th>
                            <th className="text-left px-4 py-3 font-semibold">Order ID</th>
                            <th className="text-left px-4 py-3 font-semibold">Branch</th>
                            <th className="text-left px-4 py-3 font-semibold">Customer</th>
                            <th className="text-left px-4 py-3 font-semibold">Cancelled By</th>
                            <th className="text-left px-4 py-3 font-semibold">Reason</th>
                            <th className="text-right px-4 py-3 font-semibold">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-border">
                          {filteredAuditLogs.map((log, idx) => {
                            const dateStr = log.cancelledAt
                              ? new Date(log.cancelledAt).toLocaleString()
                              : "—";
                            return (
                              <tr
                                key={`audit-${log.orderId}-${idx}`}
                                className="hover:bg-[#243147] transition-colors font-mono"
                              >
                                <td className="px-4 py-3 text-[#94a3b8] whitespace-nowrap">
                                  {dateStr}
                                </td>
                                <td className="px-4 py-3 font-bold text-brand-accent">
                                  <button
                                    onClick={() => copyTenant(log.orderId)}
                                    className="hover:underline flex items-center gap-1"
                                    title="Click to copy order ID"
                                  >
                                    {log.orderId}
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-[#f1f5f9] font-sans">{log.tenantId}</td>
                                <td className="px-4 py-3 text-[#94a3b8] font-sans">
                                  {log.customerName || log.customerEmail || "Guest"}
                                </td>
                                <td className="px-4 py-3 font-sans">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      log.cancelledBy === "CUSTOMER"
                                        ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                        : log.cancelledBy === "RESTAURANT_ADMIN"
                                        ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                                        : "bg-red-500/15 text-red-400 border border-red-500/30"
                                    }`}
                                  >
                                    {log.cancelledBy === "CUSTOMER"
                                      ? "👤 Customer"
                                      : log.cancelledBy === "RESTAURANT_ADMIN"
                                      ? "🍳 Kitchen"
                                      : "🛡️ Admin"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-rose-300 font-sans max-w-xs truncate">
                                  {log.cancellationReason}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-[#f1f5f9]">
                                  ${(log.totalAmount || 0).toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}