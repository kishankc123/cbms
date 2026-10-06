"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { registerUserAccount } from "./actions";

const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
    {children}
  </div>
);

export default function RegisterUserPage() {
  const [a, setA] = useState({ fullName: "", email: "", mobile: "", password: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await registerUserAccount(a);
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }
    // Signed in straight away: the next screen tells them to verify their email and wait to be added.
    const login = await signIn("credentials", { email: a.email, password: a.password, redirect: false });
    window.location.href = login?.error ? "/login" : "/select-organization";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-lg bg-white p-8 shadow">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Create a user account</h1>
          <p className="text-sm text-gray-500">Your own login. An organization you work for adds you to it using your email address.</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name *">
            <input className={inputCls} required autoComplete="name" value={a.fullName} onChange={(e) => setA({ ...a, fullName: e.target.value })} />
          </Field>
          <Field label="Email *">
            <input type="email" className={inputCls} required autoComplete="username" value={a.email} onChange={(e) => setA({ ...a, email: e.target.value })} />
          </Field>
          <Field label="Contact number">
            <input className={inputCls} inputMode="tel" autoComplete="tel" value={a.mobile} onChange={(e) => setA({ ...a, mobile: e.target.value })} />
          </Field>
          <Field label="Password *">
            <input type="password" className={inputCls} required autoComplete="new-password" value={a.password} onChange={(e) => setA({ ...a, password: e.target.value })} />
          </Field>
          <Field label="Confirm password *">
            <input type="password" className={inputCls} required autoComplete="new-password" value={a.confirmPassword} onChange={(e) => setA({ ...a, confirmPassword: e.target.value })} />
          </Field>
          <p className="text-xs text-gray-500">At least 8 characters with a letter and a number. We email you a link to verify the address; an organization can only add you once it is verified.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className="w-full rounded bg-[var(--color-primary)] py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {loading ? "Creating..." : "Create user account"}
          </button>
        </form>

        <div className="space-y-1 text-center text-sm text-gray-500">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--color-primary)] hover:underline">
              Sign in
            </Link>
          </p>
          <p>
            Setting up a business instead?{" "}
            <Link href="/register" className="text-[var(--color-primary)] hover:underline">
              Create a business account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
