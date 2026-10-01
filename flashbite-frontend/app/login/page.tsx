"use client";
/**
 * @file app/login/page.tsx
 * @description FlashBite login, registration, and forgot-password page.
 *              Split-screen: hero left, auth card right.
 *              Handles CUSTOMER and RESTAURANT_ADMIN registration flows.
 *              Includes live password strength validation and forgot-password modal.
 */

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Zap, Radio, BarChart2, Check, X, KeyRound } from "lucide-react";
import api from "@/lib/api";
import { saveAuth, getUser, dashboardFor } from "@/lib/auth";
import toast from "react-hot-toast";

type Tab = "signin" | "register";
type AccountType = "CUSTOMER" | "RESTAURANT";

// ── Password Rules & Regex ──────────────────────────────────────────
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/;

export interface PasswordCriteria {
  length: boolean;
  lowercase: boolean;
  uppercase: boolean;
  digit: boolean;
  special: boolean;
}

export function checkPasswordCriteria(password: string): PasswordCriteria {
  return {
    length: password.length >= 8 && password.length <= 64,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    special: /[@$!%*?&]/.test(password),
  };
}

export function calculatePasswordStrength(criteria: PasswordCriteria): { score: number; label: string; color: string } {
  const metCount = Object.values(criteria).filter(Boolean).length;
  if (metCount <= 2) return { score: 1, label: "Weak", color: "bg-red-500 text-red-400" };
  if (metCount <= 4) return { score: 2, label: "Medium", color: "bg-yellow-500 text-yellow-400" };
  return { score: 3, label: "Strong", color: "bg-emerald-500 text-emerald-400" };
}

// ── Reusable Form Components (Defined OUTSIDE component to prevent focus loss) ──
const inputClass = "w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-3 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent transition-colors";

export function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder = "Password",
  required = true,
  name = "password",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  required?: boolean;
  name?: string;
  id?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="current-password"
        className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-3 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-brand-accent transition-colors pr-11"
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] transition-colors p-1"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function PasswordStrengthView({ password }: { password: string }) {
  if (!password) return null;

  const criteria = checkPasswordCriteria(password);
  const { score, label } = calculatePasswordStrength(criteria);

  return (
    <div className="space-y-2 pt-1 animate-fade-in">
      {/* Strength Bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-brand-bg rounded-full overflow-hidden flex gap-1">
          <div className={`h-full flex-1 rounded-full transition-all ${score >= 1 ? (score === 1 ? "bg-red-500" : score === 2 ? "bg-yellow-500" : "bg-emerald-500") : "bg-brand-border"}`} />
          <div className={`h-full flex-1 rounded-full transition-all ${score >= 2 ? (score === 2 ? "bg-yellow-500" : "bg-emerald-500") : "bg-brand-border"}`} />
          <div className={`h-full flex-1 rounded-full transition-all ${score >= 3 ? "bg-emerald-500" : "bg-brand-border"}`} />
        </div>
        <span className={`text-[11px] font-semibold ${score === 1 ? "text-red-400" : score === 2 ? "text-yellow-400" : "text-emerald-400"}`}>
          {label}
        </span>
      </div>

      {/* Criteria Checklist */}
      <div className="grid grid-cols-2 gap-1 text-[11px] text-[#94a3b8] bg-brand-bg/50 p-2.5 rounded-lg border border-brand-border">
        <span className={`flex items-center gap-1.5 ${criteria.length ? "text-emerald-400 font-medium" : "text-[#64748b]"}`}>
          {criteria.length ? <Check size={12} /> : <X size={12} />} 8–64 characters
        </span>
        <span className={`flex items-center gap-1.5 ${criteria.uppercase ? "text-emerald-400 font-medium" : "text-[#64748b]"}`}>
          {criteria.uppercase ? <Check size={12} /> : <X size={12} />} 1 Uppercase (A-Z)
        </span>
        <span className={`flex items-center gap-1.5 ${criteria.lowercase ? "text-emerald-400 font-medium" : "text-[#64748b]"}`}>
          {criteria.lowercase ? <Check size={12} /> : <X size={12} />} 1 Lowercase (a-z)
        </span>
        <span className={`flex items-center gap-1.5 ${criteria.digit ? "text-emerald-400 font-medium" : "text-[#64748b]"}`}>
          {criteria.digit ? <Check size={12} /> : <X size={12} />} 1 Number (0-9)
        </span>
        <span className={`col-span-2 flex items-center gap-1.5 ${criteria.special ? "text-emerald-400 font-medium" : "text-[#64748b]"}`}>
          {criteria.special ? <Check size={12} /> : <X size={12} />} 1 Special symbol (@$!%*?&)
        </span>
      </div>
    </div>
  );
}

// ── Field state types ────────────────────────────────────────────────
interface LoginForm   { email: string; password: string }
interface RegisterForm {
  name: string; email: string; password: string; phone: string;
  accountType: AccountType;
  restaurantName: string; restaurantLocation: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("signin");

  // ── Login state ──────────────────────────────────────────────────
  const [loginForm, setLoginForm] = useState<LoginForm>({ email: "", password: "" });
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Register state ───────────────────────────────────────────────
  const [regForm, setRegForm] = useState<RegisterForm>({
    name: "", email: "", password: "", phone: "",
    accountType: "CUSTOMER",
    restaurantName: "", restaurantLocation: "",
  });
  const [showRegPw, setShowRegPw] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  // ── Forgot Password Modal state ──────────────────────────────────
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");

  // ── Auth guard ───────────────────────────────────────────────────
  useEffect(() => {
    const user = getUser();
    if (user) router.replace(dashboardFor(user.role));
  }, [router]);

  // ── Handlers ─────────────────────────────────────────────────────
  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    try {
      const { data } = await api.post("/api/auth/login", {
        email: loginForm.email,
        password: loginForm.password,
      });
      saveAuth(data.token, data.user);
      toast.success(`Welcome back, ${data.user.name}!`);
      router.replace(dashboardFor(data.user.role));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Login failed. Check your credentials.";
      toast.error(msg);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();

    if (!PASSWORD_REGEX.test(regForm.password)) {
      toast.error("Password does not meet the security requirements.");
      return;
    }

    setRegLoading(true);
    try {
      const body: Record<string, string> = {
        name:        regForm.name,
        email:       regForm.email,
        password:    regForm.password,
        phone:       regForm.phone,
        accountType: regForm.accountType,
      };
      if (regForm.accountType === "RESTAURANT") {
        body.restaurantName     = regForm.restaurantName;
        body.restaurantLocation = regForm.restaurantLocation;
      }
      const { data } = await api.post("/api/auth/register", body);
      saveAuth(data.token, data.user);
      toast.success(`Account created! Welcome, ${data.user.name}!`);
      if (regForm.accountType === "RESTAURANT") {
        toast.success(`Your branch ID: ${data.restaurant?.tenantId}`, { duration: 8000 });
      }
      router.replace(dashboardFor(data.user.role));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Registration failed.";
      toast.error(msg);
    } finally {
      setRegLoading(false);
    }
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      toast.error("Please enter your email address.");
      return;
    }

    setForgotLoading(true);
    setForgotMessage("");

    try {
      const { data } = await api.post("/api/auth/forgot-password", { email: forgotEmail });
      setForgotMessage(data.message || "If an account exists, a reset link has been sent.");
      toast.success("Reset request processed.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to send reset link.";
      toast.error(msg);
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* ── Left Hero ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-center px-16 py-12 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0f172a 0%, #1a2744 50%, #0f172a 100%)" }}>
        <div className="absolute top-1/4 -left-20 w-72 h-72 bg-brand-accent/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 -right-20 w-72 h-72 bg-brand-accent/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-5xl">⚡</span>
            <span className="text-5xl font-extrabold bg-gradient-to-r from-brand-accent to-orange-400 bg-clip-text text-transparent">
              FlashBite
            </span>
          </div>
          <p className="text-[#94a3b8] text-lg leading-relaxed max-w-sm">
            The Complete Restaurant Operations Platform for the modern era.
          </p>
        </div>

        {[
          { icon: <Zap size={20} className="text-brand-accent" />, title: "Instant Dispatch", desc: "Orders flow from customer to kitchen in milliseconds via Apache Kafka event streaming." },
          { icon: <Radio size={20} className="text-brand-accent" />, title: "Real-Time Tracking", desc: "Live order status pushed to customers instantly via Socket.IO WebSockets." },
          { icon: <BarChart2 size={20} className="text-brand-accent" />, title: "Branch Analytics", desc: "Monitor all locations, order volumes, and telemetry from one unified dashboard." },
        ].map((f) => (
          <div key={f.title}
            className="flex gap-4 p-4 mb-4 rounded-xl border-l-2 border-brand-accent"
            style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="mt-0.5 shrink-0">{f.icon}</div>
            <div>
              <p className="font-semibold text-[#f1f5f9] mb-0.5">{f.title}</p>
              <p className="text-[#94a3b8] text-sm">{f.desc}</p>
            </div>
          </div>
        ))}

        <p className="mt-6 text-[#64748b] text-xs">Powered by Kafka · Redis · Socket.IO · MongoDB</p>
      </div>

      {/* ── Right Auth Card ───────────────────────────────────────── */}
      <div className="flex items-center justify-center px-6 py-12 bg-brand-bg">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <span className="text-2xl">⚡</span>
            <span className="text-2xl font-extrabold bg-gradient-to-r from-brand-accent to-orange-400 bg-clip-text text-transparent">
              FlashBite
            </span>
          </div>

          {/* Tab switcher */}
          <div className="flex bg-brand-card border border-brand-border rounded-xl p-1 mb-8">
            {(["signin", "register"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                  tab === t
                    ? "bg-brand-accent text-white shadow-md"
                    : "text-[#94a3b8] hover:text-[#f1f5f9]"
                }`}
              >
                {t === "signin" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          {/* ── SIGN IN FORM ── */}
          {tab === "signin" && (
            <form onSubmit={handleLogin} className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-bold text-[#f1f5f9] mb-1">Welcome back</h2>
              <p className="text-[#94a3b8] text-sm mb-6">Sign in to your FlashBite account.</p>

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Email address</label>
                <input
                  type="email" placeholder="name@company.com" required
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[#94a3b8]">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(loginForm.email);
                      setShowForgotModal(true);
                      setForgotMessage("");
                    }}
                    className="text-xs text-brand-accent hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <PasswordInput
                  value={loginForm.password}
                  onChange={(v) => setLoginForm({ ...loginForm, password: v })}
                  show={showLoginPw}
                  onToggle={() => setShowLoginPw(!showLoginPw)}
                  placeholder="Enter your password"
                />
              </div>

              <button
                type="submit" disabled={loginLoading}
                className="w-full flex items-center justify-center gap-2 bg-brand-accent hover:bg-brand-accent-h text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loginLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                {loginLoading ? "Signing in…" : "Sign In"}
              </button>

              <p className="text-center text-[#64748b] text-xs pt-2">
                No account?{" "}
                <button type="button" onClick={() => setTab("register")} className="text-brand-accent hover:underline">
                  Register here
                </button>
              </p>
            </form>
          )}

          {/* ── REGISTER FORM ── */}
          {tab === "register" && (
            <form onSubmit={handleRegister} className="space-y-4 animate-fade-in">
              <h2 className="text-xl font-bold text-[#f1f5f9] mb-1">Create account</h2>
              <p className="text-[#94a3b8] text-sm mb-6">Join FlashBite as a customer or restaurant partner.</p>

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Full name</label>
                <input
                  type="text" placeholder="John Doe" required
                  value={regForm.name}
                  onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Email address</label>
                <input
                  type="email" placeholder="john@example.com" required
                  value={regForm.email}
                  onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Password</label>
                <PasswordInput
                  value={regForm.password}
                  onChange={(v) => setRegForm({ ...regForm, password: v })}
                  show={showRegPw}
                  onToggle={() => setShowRegPw(!showRegPw)}
                  placeholder="Create a strong password"
                />
                <PasswordStrengthView password={regForm.password} />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Phone number (optional)</label>
                <input
                  type="tel" placeholder="+1 (555) 000-0000"
                  value={regForm.phone}
                  onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                  className={inputClass}
                />
              </div>

              {/* Account type toggle */}
              <div>
                <p className="text-xs text-[#94a3b8] font-medium mb-2">Account type</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { val: "CUSTOMER",   label: "👤 Customer",          desc: "Order food" },
                    { val: "RESTAURANT", label: "🍽️ Restaurant Partner", desc: "Manage your kitchen" },
                  ] as const).map(({ val, label, desc }) => (
                    <button
                      key={val} type="button"
                      onClick={() => setRegForm({ ...regForm, accountType: val })}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        regForm.accountType === val
                          ? "border-brand-accent bg-brand-accent/10"
                          : "border-brand-border hover:border-brand-border-l"
                      }`}
                    >
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="text-xs text-[#94a3b8]">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Restaurant-only fields */}
              {regForm.accountType === "RESTAURANT" && (
                <div className="space-y-3 animate-slide-up">
                  <div className="border border-brand-accent/30 rounded-xl p-4 bg-brand-accent/5">
                    <p className="text-xs text-brand-accent font-semibold mb-3">🍽️ Restaurant Details</p>
                    <input
                      type="text" placeholder="Restaurant name" required
                      value={regForm.restaurantName}
                      onChange={(e) => setRegForm({ ...regForm, restaurantName: e.target.value })}
                      className={`${inputClass} mb-3`}
                    />
                    <input
                      type="text" placeholder="Location / City"  required
                      value={regForm.restaurantLocation}
                      onChange={(e) => setRegForm({ ...regForm, restaurantLocation: e.target.value })}
                      className={inputClass}
                    />
                    <p className="text-xs text-[#64748b] mt-2">A unique Branch ID will be generated automatically.</p>
                  </div>
                </div>
              )}

              <button
                type="submit" disabled={regLoading}
                className="w-full flex items-center justify-center gap-2 bg-brand-accent hover:bg-brand-accent-h text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
              >
                {regLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                {regLoading ? "Creating account…" : "Create Account"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ── Forgot Password Modal ─────────────────────────────────── */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-brand-card border border-brand-border rounded-2xl p-6 w-full max-w-md relative shadow-2xl">
            <button
              onClick={() => setShowForgotModal(false)}
              className="absolute top-4 right-4 text-[#94a3b8] hover:text-white transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-brand-accent/10 border border-brand-accent/30 flex items-center justify-center text-brand-accent">
                <KeyRound size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#f1f5f9]">Forgot Password</h3>
                <p className="text-xs text-[#94a3b8]">Enter your registered email to receive a reset link</p>
              </div>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Email Address</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className={inputClass}
                />
              </div>

              {forgotMessage && (
                <div className="p-3 bg-brand-bg rounded-lg border border-brand-border text-xs text-[#94a3b8]">
                  <p className="text-emerald-400 font-medium">✓ {forgotMessage}</p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowForgotModal(false)}
                  className="px-4 py-2.5 rounded-lg border border-brand-border text-sm text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-accent hover:bg-brand-accent-h text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
                >
                  {forgotLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  {forgotLoading ? "Sending…" : "Send Reset Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
