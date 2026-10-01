/**
 * @file lib/auth.ts
 * @description Client-side auth utilities: save/get/clear JWT + user, role guard.
 */
import type { User } from "./types";

const TOKEN_KEY = "fb_token";
const USER_KEY  = "fb_user";

/** Persist JWT + user to localStorage after login/register. */
export function saveAuth(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Read current user from localStorage. Returns null if not logged in. */
export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/** Read raw JWT string from localStorage. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** Clear auth state and redirect to /login. */
export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = "/login";
}

/** Return the correct dashboard URL for a given role. */
export function dashboardFor(role: User["role"]): string {
  switch (role) {
    case "CUSTOMER":         return "/customer";
    case "RESTAURANT_ADMIN": return "/restaurant";
    case "SUPER_ADMIN":      return "/admin";
    default:                 return "/login";
  }
}
