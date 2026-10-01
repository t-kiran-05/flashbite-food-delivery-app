/**
 * @file components/Navbar.tsx
 * @description Shared sticky navigation bar used by all authenticated pages.
 */
"use client";
import { logout } from "@/lib/auth";
import { LogOut } from "lucide-react";

interface NavbarProps {
  title: string;
  badge?: string;
  badgeColor?: string; // tailwind bg class e.g. "bg-red-500"
  rightSlot?: React.ReactNode;
}

export default function Navbar({ title, badge, badgeColor = "bg-brand-accent", rightSlot }: NavbarProps) {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-6 h-16 bg-brand-card border-b border-brand-border">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <span className="text-xl">⚡</span>
        <span className="text-lg font-extrabold bg-gradient-to-r from-brand-accent to-orange-400 bg-clip-text text-transparent">
          FlashBite
        </span>
      </div>

      {/* Title + badge */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-[#f1f5f9]">{title}</span>
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>

      {/* Right slot + logout */}
      <div className="flex items-center gap-3">
        {rightSlot}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </nav>
  );
}
