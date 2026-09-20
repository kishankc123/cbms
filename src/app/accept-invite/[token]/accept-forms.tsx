"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { acceptInviteExisting, acceptInviteNew } from "../actions";

const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";
const btnCls = "w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium disabled:opacity-50";

export function AcceptExisting({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept() {
    setLoading(true);
    const r = await acceptInviteExisting(token);
    // Success redirects; a returned value is an error.
    setLoading(false);
    if (r && !r.ok) setError(r.error);
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={accept} disabled={loading} className={btnCls}>
        {loading ? "Joining..." : "Accept invitation"}
      </button>
    </div>
  );
}

export function AcceptNew({ token }: { token: string }) {
  const [f, setF] = useState({ name: "", mobile: "", password: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const r = await acceptInviteNew(token, f);
    if (!r.ok) {
      setLoading(false);
      return setError(r.error);
    }
    const login = await signIn("credentials", { email: r.email, password: f.password, redirect: false });
    window.location.href = login?.error ? "/login" : "/dashboard";
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600">Create your password to join.</p>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
        <input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Mobile number (optional)</label>
        <input className={inputCls} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input type="password" required autoComplete="new-password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
        <input type="password" required autoComplete="new-password" className={inputCls} value={f.confirmPassword} onChange={(e) => setF({ ...f, confirmPassword: e.target.value })} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className={btnCls}>
        {loading ? "Creating account..." : "Create account & join"}
      </button>
    </form>
  );
}
