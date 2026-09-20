"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

// Only ever return to a relative path inside this app.
function safeCallback(): string {
  const cb = new URLSearchParams(window.location.search).get("callbackUrl");
  return cb && cb.startsWith("/") && !cb.startsWith("//") ? cb : "/dashboard";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setLoading(false);
      setError("Invalid email or password, or the account is temporarily locked after too many attempts.");
      return;
    }
    // Full navigation so the app reads the fresh session; the proxy sends
    // multi-organization users on to the organization picker.
    window.location.href = safeCallback();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-lg shadow p-8 space-y-4" autoComplete="on">
        <h1 className="text-xl font-semibold text-gray-900">Client Books Sign In</h1>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <Link href="/forgot-password" className="text-xs text-[var(--color-primary)] hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Login"}
        </button>

        <p className="text-center text-sm text-gray-500">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-[var(--color-primary)] hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
