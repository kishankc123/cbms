"use client";

import { useState } from "react";
import Link from "next/link";
import { createAdditionalOrganization } from "../select-organization/actions";

const inputCls = "w-full rounded border border-gray-300 px-3 py-2 text-sm";

export default function CreateOrganizationPage() {
  const [b, setB] = useState({ name: "", businessType: "", country: "Nepal", address: "", phone: "", email: "", panNumber: "", vatNumber: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await createAdditionalOrganization(b);
    // On success the action redirects; a returned value means an error.
    setLoading(false);
    if (result && !result.ok) setError(result.error);
  }

  const f = (key: keyof typeof b, label: string, type = "text") => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} className={inputCls} value={b[key]} onChange={(e) => setB({ ...b, [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-3">
        <h1 className="text-xl font-semibold text-gray-900">Create new organization</h1>
        <p className="text-sm text-gray-500">You will be its Owner. Your existing account and password stay the same.</p>
        {f("name", "Business / Organization name *")}
        <div className="grid grid-cols-2 gap-3">
          {f("businessType", "Business type")}
          {f("country", "Country")}
        </div>
        {f("address", "Address")}
        <div className="grid grid-cols-2 gap-3">
          {f("phone", "Phone")}
          {f("email", "Business email", "email")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {f("panNumber", "PAN / Tax reg. no.")}
          {f("vatNumber", "VAT reg. no.")}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Link href="/select-organization" className="rounded border border-gray-300 text-gray-700 px-4 py-2 text-sm">
            Cancel
          </Link>
          <button type="submit" disabled={loading} className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium disabled:opacity-50">
            {loading ? "Creating..." : "Create Organization"}
          </button>
        </div>
      </form>
    </div>
  );
}
