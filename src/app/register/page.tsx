"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { registerOrganization } from "./actions";

const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
  </div>
);

export default function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [b, setB] = useState({ name: "", businessType: "", country: "Nepal", address: "", phone: "", email: "", panNumber: "", companyRegistrationNumber: "" });
  const [a, setA] = useState({ fullName: "", email: "", mobile: "", password: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function next(e: React.FormEvent) {
    e.preventDefault();
    if (!b.name.trim()) return setError("Business name is required.");
    setError(null);
    setStep(2);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await registerOrganization({ business: b, admin: a });
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }
    const login = await signIn("credentials", { email: a.email, password: a.password, redirect: false });
    window.location.href = login?.error ? "/login" : "/dashboard";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Create an account</h1>
          <p className="text-sm text-gray-500">
            Step {step} of 2 — {step === 1 ? "Business information" : "Primary administrator"}
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={next} className="space-y-3">
            <Field label="Business / Organization name *">
              <input className={inputCls} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Business type">
                <input className={inputCls} value={b.businessType} onChange={(e) => setB({ ...b, businessType: e.target.value })} placeholder="e.g. Restaurant" />
              </Field>
              <Field label="Country">
                <input className={inputCls} value={b.country} onChange={(e) => setB({ ...b, country: e.target.value })} />
              </Field>
            </div>
            <Field label="Address">
              <input className={inputCls} value={b.address} onChange={(e) => setB({ ...b, address: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input className={inputCls} value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} />
              </Field>
              <Field label="Business email">
                <input type="email" className={inputCls} value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PAN / VAT number">
                <input className={inputCls} value={b.panNumber} onChange={(e) => setB({ ...b, panNumber: e.target.value })} />
              </Field>
              <Field label="Company registration no.">
                <input className={inputCls} value={b.companyRegistrationNumber} onChange={(e) => setB({ ...b, companyRegistrationNumber: e.target.value })} />
              </Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium">
              Continue
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full name *">
              <input className={inputCls} required value={a.fullName} onChange={(e) => setA({ ...a, fullName: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email *">
                <input type="email" className={inputCls} required autoComplete="username" value={a.email} onChange={(e) => setA({ ...a, email: e.target.value })} />
              </Field>
              <Field label="Mobile number">
                <input className={inputCls} value={a.mobile} onChange={(e) => setA({ ...a, mobile: e.target.value })} />
              </Field>
            </div>
            <Field label="Password *">
              <input type="password" className={inputCls} required autoComplete="new-password" value={a.password} onChange={(e) => setA({ ...a, password: e.target.value })} />
            </Field>
            <Field label="Confirm password *">
              <input type="password" className={inputCls} required autoComplete="new-password" value={a.confirmPassword} onChange={(e) => setA({ ...a, confirmPassword: e.target.value })} />
            </Field>
            <p className="text-xs text-gray-500">At least 8 characters with a letter and a number. You will be the Owner of {b.name || "this organization"}.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(1)} className="rounded border border-gray-300 text-gray-700 px-4 py-2 text-sm">
                Back
              </button>
              <button type="submit" disabled={loading} className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium disabled:opacity-50">
                {loading ? "Creating..." : "Create Account"}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--color-primary)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
