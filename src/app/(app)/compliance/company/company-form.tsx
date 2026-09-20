"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyDetails, type getCompanyDetails } from "../company-actions";
import { DatePicker } from "@/components/calendar/date-picker";

type Data = Awaited<ReturnType<typeof getCompanyDetails>>;

const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500";
const STATUS_LABEL: Record<string, string> = { active: "Active", dormant: "Dormant", closed: "Closed", other: "Other" };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function CompanyForm({ data }: { data: Data }) {
  const router = useRouter();
  const [v, setV] = useState(data.values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  const disabled = !data.canEdit;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveCompanyDetails({
        companyName: v.companyName,
        tradingName: v.tradingName,
        companyRegistrationNumber: v.companyRegistrationNumber,
        registrationDate: v.registrationDate,
        panVatNumber: v.panVatNumber,
        registeredOffice: v.registeredOffice,
        businessAddress: v.businessAddress,
        natureOfBusiness: v.natureOfBusiness,
        companyStatus: v.companyStatus,
        companyStatusNote: v.companyStatusNote,
        countryCode: v.countryCode,
        entityType: v.entityType,
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Basic information</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Legal name">
            <input className={input} value={v.companyName} onChange={(e) => set("companyName", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Trading name">
            <input className={input} value={v.tradingName} onChange={(e) => set("tradingName", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Country">
            <select className={input} value={v.countryCode} onChange={(e) => set("countryCode", e.target.value)} disabled={disabled}>
              {data.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Company type" hint="Decides which requirements apply to you.">
            <select className={input} value={v.entityType} onChange={(e) => set("entityType", e.target.value)} disabled={disabled}>
              <option value="">Select company type</option>
              {data.entityTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Company registration number">
            <input className={input} value={v.companyRegistrationNumber} onChange={(e) => set("companyRegistrationNumber", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Registration date">
            <DatePicker value={v.registrationDate} onChange={(d) => set("registrationDate", d)} disabled={disabled} className={input} />
          </Field>
          <Field label="PAN / VAT number" hint="One number, used everywhere — invoices, VAT and tax registrations.">
            <input className={input} value={v.panVatNumber} onChange={(e) => set("panVatNumber", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Nature of business">
            <input className={input} value={v.natureOfBusiness} onChange={(e) => set("natureOfBusiness", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Registered office">
            <input className={input} value={v.registeredOffice} onChange={(e) => set("registeredOffice", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Business address">
            <input className={input} value={v.businessAddress} onChange={(e) => set("businessAddress", e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Financial year" hint="Change it in Settings > Dates.">
            <input
              className={input}
              disabled
              value={v.financialYear || "Not set"}
              readOnly
            />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Company status</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <select className={input} value={v.companyStatus} onChange={(e) => set("companyStatus", e.target.value as typeof v.companyStatus)} disabled={disabled}>
              {data.statuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </Field>
          {v.companyStatus === "other" && (
            <Field label="Describe the status">
              <input className={input} value={v.companyStatusNote} onChange={(e) => set("companyStatusNote", e.target.value)} disabled={disabled} />
            </Field>
          )}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {saved && !error && <span className="text-xs text-green-600">Saved</span>}
        {data.canEdit && (
          <button type="button" disabled={saving} onClick={handleSave} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
            {saving ? "Saving..." : "Save changes"}
          </button>
        )}
      </div>
    </div>
  );
}
