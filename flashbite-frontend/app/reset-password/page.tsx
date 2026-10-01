"use client";
/**
 * @file app/reset-password/page.tsx
 * @description Dedicated password reset page for FlashBite.
 *              Validates token from query parameters, displays live strength indicators,
 *              confirms matching passwords, and executes POST /api/auth/reset-password.
 */

import { useState, Suspense, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { KeyRound, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import {
  PasswordInput,
  PasswordStrengthView,
  PASSWORD_REGEX,
} from "@/app/login/page";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!token) {
      toast.error("Invalid or missing password reset token.");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      toast.error("Password does not meet the security requirements.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/reset-password", {
        token,
        newPassword,
      });

      toast.success(data.message || "Password reset successfully!");
      setIsSuccess(true);
      setTimeout(() => {
        router.replace("/login");
      }, 2500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to reset password. The link may have expired.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4">
          <KeyRound size={24} />
        </div>
        <h2 className="text-lg font-bold text-[#f1f5f9] mb-2">Invalid Reset Link</h2>
        <p className="text-sm text-[#94a3b8] mb-6 max-w-sm mx-auto">
          This password reset link is missing a security token or has expired.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-accent hover:bg-brand-accent-h text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <ArrowLeft size={16} /> Return to Login
        </Link>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="text-center py-8 animate-fade-in">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="text-xl font-bold text-[#f1f5f9] mb-2">Password Reset Complete!</h2>
        <p className="text-sm text-[#94a3b8] mb-6">
          Your password has been successfully updated. Redirecting you to login…
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-accent hover:bg-brand-accent-h text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Go to Login Now
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">New Password</label>
        <PasswordInput
          value={newPassword}
          onChange={setNewPassword}
          show={showPw}
          onToggle={() => setShowPw(!showPw)}
          placeholder="Enter new password"
        />
        <PasswordStrengthView password={newPassword} />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Confirm New Password</label>
        <PasswordInput
          value={confirmPassword}
          onChange={setConfirmPassword}
          show={showConfirmPw}
          onToggle={() => setShowConfirmPw(!showConfirmPw)}
          placeholder="Re-enter new password"
        />
        {confirmPassword && newPassword !== confirmPassword && (
          <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !newPassword || !confirmPassword || newPassword !== confirmPassword}
        className="w-full flex items-center justify-center gap-2 bg-brand-accent hover:bg-brand-accent-h text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : null}
        {loading ? "Resetting Password…" : "Reset Password"}
      </button>

      <div className="text-center pt-2">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
        >
          <ArrowLeft size={14} /> Back to Sign In
        </Link>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-brand-card border border-brand-border rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-accent/10 border border-brand-accent/30 flex items-center justify-center text-brand-accent">
            <KeyRound size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#f1f5f9]">Set New Password</h1>
            <p className="text-xs text-[#94a3b8]">Create a secure password for your account</p>
          </div>
        </div>

        <Suspense fallback={
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-brand-accent" />
          </div>
        }>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
