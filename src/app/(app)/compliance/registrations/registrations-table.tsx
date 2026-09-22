"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTaxRegistration, type listTaxRegistrations, type RegistrationInput, type RegistrationStatus } from "../registration-actions";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";

type Data = Awaited<ReturnType<typeof listTaxRegistrations>>;
type Row = Data["registrations"][number];

const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500";
const STATUS_TONE: Record<RegistrationStatus, StatusTone> = { active: "success", inactive: "action", suspended: "critical", deregistered: "critical" };
const STATUS_LABEL: Record<RegistrationStatus, string> = { active: "Active", inactive: "Inactive", suspended: "Suspended", deregistered: "Deregistered" };

const blank = (taxTypeKey: string, authorityKey: string): RegistrationInput => ({
  taxTypeKey,
  registrationNumber: "",
  registrationDate: "",
  effectiveDate: "",
  deregistrationDate: "",
  status: "active",
  filingFrequency: "",
  filingFrequencyEffectiveFrom: "",
  authorityKey,
  supportingDocument: "",
  notes: "",
});

export function RegistrationsTable({ data }: { data: Data }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ form: RegistrationInput; label: string; numberIsShared: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function edit(r: Row) {
    setError(null);
    setEditing({
      label: r.taxTypeName,
      numberIsShared: r.numberIsShared,
      form: {
        id: r.id,
        taxTypeKey: r.taxTypeKey,
        registrationNumber: r.numberIsShared ? "" : r.number,
        registrationDate: r.registrationDate,
        effectiveDate: r.effectiveDate,
        deregistrationDate: r.deregistrationDate,
        status: r.status,
        filingFrequency: r.filingFrequency,
        filingFrequencyEffectiveFrom: r.filingFrequencyEffectiveFrom,
        authorityKey: r.authorityKey,
        supportingDocument: r.supportingDocument,
        notes: r.notes,
      },
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await saveTaxRegistration(editing.form);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof RegistrationInput>(key: K, value: RegistrationInput[K]) => setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        {!data.hasPanVatNumber && (
          <span className="text-xs text-amber-700">
            Your PAN / VAT number isn&apos;t set. <Link href="/compliance/company" className="underline">Add it in Company Details</Link>.
          </span>
        )}
        {data.canEdit && (
          <button
            type="button"
            disabled={data.addable.length === 0}
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-40"
          >
            + Add Registration
          </button>
        )}
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Tax</th>
            <th className="px-4 py-2 font-medium">Registration number</th>
            <th className="px-4 py-2 font-medium">Registered</th>
            <th className="px-4 py-2 font-medium">Effective</th>
            <th className="px-4 py-2 font-medium">Filing basis</th>
            <th className="px-4 py-2 font-medium">Authority</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {data.registrations.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-medium text-gray-900">{r.taxTypeName}</td>
              <td className="px-4 py-2">{r.number || <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-2">{r.registrationDate ? <D value={r.registrationDate} /> : "—"}</td>
              <td className="px-4 py-2">
                {r.effectiveDate ? <D value={r.effectiveDate} /> : "—"}
                {r.deregistrationDate && (
                  <span className="ml-1 text-xs text-gray-400">
                    → <D value={r.deregistrationDate} />
                  </span>
                )}
              </td>
              <td className="px-4 py-2">{r.filingFrequency ? (r.filingFrequency === "monthly" ? "Monthly" : "Quarterly") : "—"}</td>
              <td className="px-4 py-2">{r.authorityName || "—"}</td>
              <td className="px-4 py-2">
                <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
              </td>
              <td className="px-4 py-2 text-right">
                <button type="button" onClick={() => edit(r)} className="text-xs text-[var(--color-primary)] hover:underline">
                  {data.canEdit ? "Edit" : "View"}
                </button>
              </td>
            </tr>
          ))}
          {data.registrations.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                No registrations yet. Add the taxes your business is registered for.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {adding && (
        <Modal title="Add registration" onClose={() => setAdding(false)}>
          <div className="space-y-2">
            {data.addable.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setAdding(false);
                  setEditing({ label: t.name, numberIsShared: t.numberIsShared, form: blank(t.key, t.authorityKey) });
                }}
                className="w-full rounded border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                {t.name}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`${editing.form.id ? "Registration" : "Add"} — ${editing.label}`} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Registration number</label>
              {editing.numberIsShared ? (
                <>
                  <input className={input} disabled value={data.registrations.find((r) => r.taxTypeKey === editing.form.taxTypeKey)?.number ?? (data.hasPanVatNumber ? "Your PAN / VAT number" : "Not set")} readOnly />
                  <p className="mt-1 text-xs text-gray-400">PAN and VAT use your company&apos;s PAN / VAT number. Change it in Company Details.</p>
                </>
              ) : (
                <input className={input} value={editing.form.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} disabled={!data.canEdit} />
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select className={input} value={editing.form.status} onChange={(e) => set("status", e.target.value as RegistrationStatus)} disabled={!data.canEdit}>
                {data.statuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tax authority</label>
              <select className={input} value={editing.form.authorityKey} onChange={(e) => set("authorityKey", e.target.value)} disabled={!data.canEdit}>
                <option value="">—</option>
                {data.authorities.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Registration date</label>
              <DatePicker value={editing.form.registrationDate} onChange={(v) => set("registrationDate", v)} disabled={!data.canEdit} className={input} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Effective date</label>
              <DatePicker value={editing.form.effectiveDate} onChange={(v) => set("effectiveDate", v)} disabled={!data.canEdit} className={input} />
            </div>
            {editing.form.status === "deregistered" && (
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Deregistration date</label>
                <DatePicker value={editing.form.deregistrationDate} onChange={(v) => set("deregistrationDate", v)} disabled={!data.canEdit} className={input} />
              </div>
            )}
            {data.filingFrequencyTaxTypes.includes(editing.form.taxTypeKey) && (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Filing basis</label>
                  <select className={input} value={editing.form.filingFrequency} onChange={(e) => set("filingFrequency", e.target.value as RegistrationInput["filingFrequency"])} disabled={!data.canEdit}>
                    <option value="">Not set</option>
                    {data.filingFrequencies.map((f) => (
                      <option key={f} value={f}>
                        {f === "monthly" ? "Monthly" : "Quarterly"}
                      </option>
                    ))}
                  </select>
                </div>
                {editing.form.filingFrequency && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Effective from</label>
                    <DatePicker value={editing.form.filingFrequencyEffectiveFrom} onChange={(v) => set("filingFrequencyEffectiveFrom", v)} disabled={!data.canEdit} className={input} />
                  </div>
                )}
                {editing.form.filingFrequency === "quarterly" && (
                  <p className="col-span-2 -mt-1 text-xs text-amber-700">
                    Quarterly filing deadlines aren&apos;t confirmed for your jurisdiction yet — the VAT return is still generated monthly until that rule is added.
                  </p>
                )}
              </>
            )}
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Supporting document (reference)</label>
              <input className={input} value={editing.form.supportingDocument} onChange={(e) => set("supportingDocument", e.target.value)} disabled={!data.canEdit} placeholder="Link or file name" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea className={input} rows={2} value={editing.form.notes} onChange={(e) => set("notes", e.target.value)} disabled={!data.canEdit} />
            </div>
          </div>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
              {data.canEdit ? "Cancel" : "Close"}
            </button>
            {data.canEdit && (
              <button type="button" disabled={busy} onClick={save} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                {busy ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-4 text-base font-semibold text-gray-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}
