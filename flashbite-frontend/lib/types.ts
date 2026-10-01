/**
 * @file lib/types.ts
 * @description Shared TypeScript interfaces for the FlashBite frontend.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "RESTAURANT_ADMIN" | "SUPER_ADMIN";
  tenantId: string | null;
}

export interface MenuItem {
  _id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  emoji: string;
  available: boolean;
  tags?: string[];
  isSpicy?: boolean;
  tenantId?: string;
  restaurantId?: {
    _id?: string;
    name: string;
    location?: string;
    rating?: number;
    tenantId?: string;
  } | null;
}

export interface CravingCriteria {
  keywords: string[];
  maxPrice: number | null;
  dietaryTags: string[];
  isSpicy: boolean | null;
}

export interface CravingSearchResponse {
  success: boolean;
  query: string;
  source?: string;
  criteria: CravingCriteria;
  count: number;
  items: MenuItem[];
  warning?: string;
  error?: string;
}

export interface CartItem extends MenuItem {
  quantity: number;
}

export interface Order {
  _id: string;
  orderId: string;
  tenantId: string;
  customerId: string;
  items: Array<{ itemId: string; name: string; price: number; quantity: number }>;
  totalAmount: number;
  status: "ORDER_RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
  cancellationReason?: string | null;
  cancelledBy?: "CUSTOMER" | "RESTAURANT_ADMIN" | "SUPER_ADMIN" | null;
  cancelledAt?: string | null;
  createdAt: string;
}

export interface Branch {
  tenantId: string;
  name: string;
  location: string;
  isActive: boolean;
  totalOrdersCount: number;
  activeOrdersCount?: number;
  liveOrderCount: number;
}

export interface StreamEvent {
  id: string;
  type: "order-created" | "order-updated" | "order-cancelled";
  orderId: string;
  tenantId: string;
  status: string;
  cancellationReason?: string;
  cancelledBy?: string;
  timestamp: string;
}

export interface TerminalLog {
  id: string;
  tag: "[KAFKA]" | "[REDIS]" | "[SOCKET]" | "[ERROR]" | "[INFO]" | "[AUDIT]";
  message: string;
  timestamp: string;
}

export interface CancellationAuditLog {
  orderId: string;
  tenantId: string;
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  cancelledBy: string;
  cancellationReason: string;
  cancelledAt: string;
  createdAt: string;
}

export interface CancellationAnalytics {
  totalOrders: number;
  totalCancelled: number;
  cancellationRate: string;
  byActor: {
    CUSTOMER: number;
    RESTAURANT_ADMIN: number;
    SUPER_ADMIN: number;
  };
  byReason: Array<{
    reason: string;
    count: number;
    percentage: string;
  }>;
  topRestaurants: Array<{
    tenantId: string;
    name: string;
    location: string;
    cancelledCount: number;
    totalBranchOrders: number;
    rate: string;
  }>;
  auditLogs: CancellationAuditLog[];
}
