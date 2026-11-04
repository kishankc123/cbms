"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/brand/logo";

// Only ever return to a relative path inside this app.
function safeCallback(): string {
  const cb = new URLSearchParams(window.location.search).get("callbackUrl");
  return cb && cb.startsWith("/") && !cb.startsWith("//") ? cb : "/dashboard";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", { email, password, remember: String(remember), redirect: false });
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
    <div className="grid min-h-screen grid-cols-1 bg-surface lg:grid-cols-2">
      <aside className="flex flex-col justify-between bg-[#1e2133] px-6 py-5 text-white lg:px-10 lg:py-10">
        <Logo tone="dark" size={28} className="text-white" />
        <div className="hidden lg:block">
          <p className="max-w-sm text-[28px] font-semibold leading-9 tracking-tight">
            Your books, your cash,
            <br />
            one clear picture.
          </p>
        </div>
        <p className="hidden text-xs text-[#8d90ad] lg:block">Made for every business around the globe</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-10">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4" autoComplete="on">
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Sign in</h1>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink-2">
                Password
              </label>
              <Link href="/forgot-password" className="text-xs text-[var(--accent-text)] hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-[5px] pr-16 text-[13px] text-ink transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-2 hover:text-ink"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-line-strong" />
            Remember me
          </label>

          {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <div className="space-y-2 border-t border-line pt-4 text-center text-sm text-ink-2">
            <p>
              Setting up a business?{" "}
              <Link href="/register" className="text-[var(--accent-text)] hover:underline">
                Create a business account
              </Link>
            </p>
            <p>
              Joining an organization that already uses Workdela?{" "}
              <Link href="/register/user" className="text-[var(--accent-text)] hover:underline">
                Create a user account
              </Link>
            </p>
          </div>
          <p className="pt-2 text-center text-xs text-ink-2 lg:hidden">Made for every business around the globe</p>
        </form>
      </main>
    </div>
  );
}
