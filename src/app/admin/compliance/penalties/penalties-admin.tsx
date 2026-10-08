"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { ConfirmDialog } from "@/app/(app)/sales/confirm-dialog";
import { PENALTY_TYPES, PERMIT_ACTIONS, summarize, toForm, type FormValues, type PenaltyTypeKey, type PermitAction } from "@/lib/compliance/penalty-types";
import type { Version } from "@/lib/compliance/penalty-admin";
import { adminCard, adminField } from "../../ui";
import { addPenaltyVersion, editPenaltyVersion, removePenaltyVersion, type PenaltyAdminData } from "./actions";

type Editing = { id: string | null; type: PenaltyTypeKey; started: boolean; fiscalYearStart: number | null; form: FormValues; isVerified: boolean; source: string };

const blankTier = { upToMonths: "", ratePercent: "", action: "restricted" as PermitAction };

export function PenaltiesAdmin({ data }: { data: PenaltyAdminData }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Version | null>(null);
  const [saving, setSaving] = useState(false);

  if (!data.country || !data.timeline) return <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No country is configured yet.</p>;
  const country = data.country;
  const timeline = data.timeline;

  function startAdd(type: PenaltyTypeKey) {
    const versions = timeline[type];
    const latest = versions[versions.length - 1];
    const latestFrom = latest?.effectiveFrom ?? "";
    const firstFree = data.fiscalYears.find((f) => f.from > latestFrom);
    // The new version starts from a copy of the latest figures, so only what changed has to be typed.
    setEditing({ id: null, type, started: false, fiscalYearStart: firstFree?.startYear ?? null, form: toForm(type, latest?.params), isVerified: false, source: "" });
  }

  function startEdit(v: Version) {
    setEditing({ id: v.id, type: v.taxTypeKey, started: !v.editable, fiscalYearStart: null, form: toForm(v.taxTypeKey, v.params), isVerified: v.isVerified, source: v.source ?? "" });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const r = editing.id
        ? await editPenaltyVersion({ id: editing.id, form: editing.form, isVerified: editing.isVerified, source: editing.source })
        : editing.fiscalYearStart === null
          ? { ok: false as const, error: "Choose the fiscal year this version starts in." }
          : await addPenaltyVersion({ countryCode: country.code, taxTypeKey: editing.type, fiscalYearStart: editing.fiscalYearStart, form: editing.form, isVerified: editing.isVerified, source: editing.source });
      if (!r.ok) return report(r.error);
      setEditing(null);
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const v = deleting;
    setDeleting(null);
    if (!v) return;
    try {
      const r = await removePenaltyVersion(v.id);
      if (!r.ok) return report(r.error);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  const spec = editing ? PENALTY_TYPES.find((t) => t.key === editing.type)! : null;
  const setField = (key: string, value: string) => editing && setEditing({ ...editing, form: { ...editing.form, fields: { ...editing.form.fields, [key]: value } } });
  const setTier = (i: number, patch: Partial<FormValues["tiers"][number]>) => editing && setEditing({ ...editing, form: { ...editing.form, tiers: editing.form.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) } });
  const takenYears = (type: PenaltyTypeKey) => timeline[type][timeline[type].length - 1]?.effectiveFrom ?? "";

  return (
    <div className="space-y-5">
      {data.countries.length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {data.countries.map((c) => (
            <Link key={c.code} href={`/admin/compliance/penalties?country=${c.code}`} className={`rounded-full px-3 py-1 ${c.code === country.code ? "bg-[var(--color-primary)] text-white" : "bg-[var(--surface-muted-bg)] text-[var(--text-secondary)]"}`}>
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {PENALTY_TYPES.map((t) => (
        <section key={t.key} className={`${adminCard} space-y-3 p-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium text-[var(--text-primary)]">{t.label}</h2>
              <p className="text-sm text-[var(--text-secondary)]">{t.description}</p>
            </div>
            <button type="button" onClick={() => startAdd(t.key)} className="shrink-0 rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
              New version
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Starts</th>
                  <th className="px-3 py-2 font-medium">Figures</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {[...timeline[t.key]].reverse().map((v) => (
                  <tr key={v.id} className="border-t border-[var(--card-border)] align-top">
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-medium">{v.fiscalYear ? `FY ${v.fiscalYear}` : "Original"}</span>
                      <br />
                      <span className="text-xs text-[var(--text-secondary)]">
                        <D value={v.effectiveFrom} />
                        {v.effectiveTo && (
                          <>
                            {" "}
                            to <D value={v.effectiveTo} />
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      <ul className="space-y-0.5">
                        {summarize(v.taxTypeKey, v.params).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="space-y-1 px-3 py-2">
                      <div>{v.inForce ? <StatusPill tone="success">In force</StatusPill> : v.editable ? <StatusPill tone="action">Upcoming</StatusPill> : <StatusPill tone="pending">Past</StatusPill>}</div>
                      <div>{v.isVerified ? <StatusPill tone="success">Verified</StatusPill> : <StatusPill tone="action">Not verified</StatusPill>}</div>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{v.source || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" className="mr-3 text-[var(--color-primary)] hover:underline" onClick={() => startEdit(v)}>
                        {v.editable ? "Edit" : "Verify / source"}
                      </button>
                      {v.editable && (
                        <button type="button" className="text-red-600 hover:underline" onClick={() => setDeleting(v)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {timeline[t.key].length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-[var(--text-secondary)]">
                      No figures yet. Add the first version.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {editing && spec && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !saving && setEditing(null)} />
          <div className="relative max-h-[88vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg bg-[var(--card-bg)] p-5 shadow-lg">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">
              {spec.label}: {editing.id ? (editing.started ? "verification and source" : "edit version") : "new version"}
            </h2>

            {!editing.id && (
              <div>
                <label className="mb-1 block text-xs text-gray-500">Starts on Shrawan 1 of fiscal year</label>
                <select className={`${adminField} w-full`} value={editing.fiscalYearStart ?? ""} onChange={(e) => setEditing({ ...editing, fiscalYearStart: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Choose a fiscal year</option>
                  {data.fiscalYears
                    .filter((f) => f.from > takenYears(editing.type))
                    .map((f) => (
                      <option key={f.startYear} value={f.startYear}>
                        FY {f.label}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">The previous version ends the day before. The figures below start as a copy of the latest version.</p>
              </div>
            )}
            {editing.started && <p className="rounded bg-[var(--surface-muted-bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">This version has already started, so its figures are fixed. To change them, add a new version from a later fiscal year.</p>}

            {editing.type !== "excise_permit" &&
              spec.fields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs text-gray-500">
                    {f.label}
                    {f.optional ? " (optional)" : ""}
                  </label>
                  <div className="flex items-center gap-2">
                    {f.unit === "money" && <span className="text-sm text-[var(--text-secondary)]">Rs</span>}
                    <input className={`${adminField} w-32`} inputMode="decimal" disabled={editing.started} value={editing.form.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                    {f.unit === "percent" && <span className="text-sm text-[var(--text-secondary)]">%</span>}
                    <span className="text-xs text-[var(--text-secondary)]">{f.per}</span>
                  </div>
                </div>
              ))}

            {editing.type === "excise_permit" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Bands of late renewal, counted in months after the Shrawan deadline. The fine is a share of the company&apos;s standard renewal fee. The last band has no upper limit.</p>
                {editing.form.tiers.map((t, i) => {
                  const last = i === editing.form.tiers.length - 1;
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-[var(--card-border)] p-2">
                      <span className="text-xs text-[var(--text-secondary)]">Up to</span>
                      <input className={`${adminField} w-16`} disabled={editing.started || last} placeholder={last ? "no limit" : "months"} value={last ? "" : t.upToMonths} onChange={(e) => setTier(i, { upToMonths: e.target.value })} />
                      <span className="text-xs text-[var(--text-secondary)]">months late: fine</span>
                      <input className={`${adminField} w-20`} disabled={editing.started} value={t.ratePercent} onChange={(e) => setTier(i, { ratePercent: e.target.value })} />
                      <span className="text-xs text-[var(--text-secondary)]">% of fee</span>
                      <select className={adminField} disabled={editing.started} value={t.action} onChange={(e) => setTier(i, { action: e.target.value as PermitAction })}>
                        {PERMIT_ACTIONS.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                      {!editing.started && editing.form.tiers.length > 1 && (
                        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setEditing({ ...editing, form: { ...editing.form, tiers: editing.form.tiers.filter((_, idx) => idx !== i) } })}>
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
                {!editing.started && (
                  <button type="button" className="text-sm text-[var(--color-primary)] hover:underline" onClick={() => setEditing({ ...editing, form: { ...editing.form, tiers: [...editing.form.tiers, { ...blankTier }] } })}>
                    Add a band
                  </button>
                )}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-gray-500">Source (circular, notice or section)</label>
              <input className={`${adminField} w-full`} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} placeholder="Where these figures come from" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isVerified} onChange={(e) => setEditing({ ...editing, isVerified: e.target.checked })} />
              Verified against current law (organizations see an &quot;unverified&quot; notice until this is ticked)
            </label>

            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEditing(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={save} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && <ConfirmDialog message={`Delete the version that starts in ${deleting.fiscalYear ? `FY ${deleting.fiscalYear}` : "the original date"}? The version before it will carry on.`} onYes={confirmDelete} onNo={() => setDeleting(null)} />}
      {dialog}
    </div>
  );
}
