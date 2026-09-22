"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyDetails, type getCompanyDetails } from "../company-actions";
import { DatePicker } from "@/components/calendar/date-picker";

type Data = Awaited<ReturnType<typeof getCompanyDetails>>;
type Values = Data["values"];

const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500";
const STATUS_LABEL: Record<string, string> = { active: "Active", dormant: "Dormant", closed: "Closed", other: "Other" };

const SAVED_FIELDS = [
  "companyName",
  "tradingName",
  "companyRegistrationNumber",
  "registrationDate",
  "panVatNumber",
  "registeredOffice",
  "businessAddress",
  "natureOfBusiness",
  "companyStatus",
  "companyStatusNote",
  "countryCode",
  "entityType",
] as const satisfies readonly (keyof Values)[];
type SavedField = (typeof SAVED_FIELDS)[number];

const FIELD_LABEL: Record<SavedField, string> = {
  companyName: "Legal name",
  tradingName: "Trading name",
  countryCode: "Country",
  entityType: "Company type",
  companyRegistrationNumber: "Company registration number",
  registrationDate: "Registration date",
  panVatNumber: "PAN / VAT number",
  natureOfBusiness: "Nature of business",
  registeredOffice: "Registered office",
  businessAddress: "Business address",
  companyStatus: "Status",
  companyStatusNote: "Status description",
};

// Changing these decides which compliance requirements apply, or is used everywhere else in the system — worth a
// plainer warning than "this field changed".
const CONSEQUENCE: Partial<Record<keyof Values, string>> = {
  entityType: "Changing the company type changes which statutory requirements apply to you.",
  countryCode: "Changing the country changes which tax rules and requirements apply to you.",
  panVatNumber: "This number is used on invoices and as your VAT/PAN registration number — changing it here changes it everywhere.",
};

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
  const [reviewing, setReviewing] = useState(false);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  const disabled = !data.canEdit;

  const changes = SAVED_FIELDS.filter((f) => v[f] !== data.values[f]);

  function handleSaveClick() {
    if (changes.length === 0) return; // nothing to confirm — Save is effectively a no-op
    setReviewing(true);
  }

  async function confirmSave() {
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
      setReviewing(false);
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
          <Field label="PAN / VAT number *" hint="Exactly 9 digits. One number, used everywhere — invoices, VAT and tax registrations.">
            <input className={input} value={v.panVatNumber} onChange={(e) => set("panVatNumber", e.target.value)} disabled={disabled} inputMode="numeric" maxLength={9} placeholder="9 digits" />
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
          <button type="button" disabled={saving || changes.length === 0} onClick={handleSaveClick} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
            {saving ? "Saving..." : "Save changes"}
          </button>
        )}
      </div>

      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
          <div className="absolute inset-0 bg-black/30" onClick={() => !saving && setReviewing(false)} />
          <div className="relative w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900">Review changes</h2>
            <table className="w-full text-sm">
              <tbody>
                {changes.map((f) => (
                  <tr key={f} className="border-t border-gray-100 align-top">
                    <td className="py-1.5 pr-3 text-xs text-gray-500 whitespace-nowrap">{FIELD_LABEL[f]}</td>
                    <td className="py-1.5">
                      <span className="text-gray-400 line-through">{data.values[f] || "—"}</span>
                      {" → "}
                      <span className="font-medium text-gray-900">{v[f] || "—"}</span>
                      {CONSEQUENCE[f] && <p className="mt-0.5 text-xs text-amber-700">{CONSEQUENCE[f]}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setReviewing(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={confirmSave} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                {saving ? "Saving..." : "Confirm & save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
