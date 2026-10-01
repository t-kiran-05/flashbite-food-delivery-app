/**
 * @file components/StatusBadge.tsx
 * @description Maps order status strings to styled pill badges.
 */

const STATUS_MAP: Record<string, { label: string; classes: string }> = {
  ORDER_RECEIVED:   { label: "Order Received",    classes: "bg-blue-500/15 text-blue-400 border border-blue-500/30" },
  PREPARING:        { label: "Preparing",          classes: "bg-orange-500/15 text-orange-400 border border-orange-500/30" },
  OUT_FOR_DELIVERY: { label: "Out for Delivery",   classes: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30" },
  DELIVERED:        { label: "Delivered",          classes: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" },
  CANCELLED:        { label: "Cancelled",          classes: "bg-red-500/15 text-red-400 border border-red-500/30" },
};

export default function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] || { label: status, classes: "bg-slate-500/15 text-slate-400 border border-slate-500/30" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}
