"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import type { FiscalYear } from "@/lib/compliance/platform-tax-rate-types";
import type { SlabVersion } from "@/lib/compliance/slabs";
import { TAXPAYER_CLASSES, changedSlabRows, type Slab, type SlabTables, type TaxpayerClass } from "@/lib/compliance/slab-tables";
import { adminCard, adminField } from "../../ui";
import { confirmSlabs, editSlabNotes, publishSlabs, type TaxRateAdminData } from "./actions";
import { bothDates } from "./tax-rates-admin";

type Row = { upTo: string; rate: string };
type Editor = { draftId: string | null; effectiveFrom: string; source: string; isVerified: boolean; rows: Record<TaxpayerClass, Row[]> };

const money = (n: number) => n.toLocaleString("en-IN");
const toRows = (slabs: Slab[]): Row[] => slabs.map((s) => ({ upTo: s.upTo === null ? "" : String(s.upTo), rate: String(s.rate) }));
const blank = (): Record<TaxpayerClass, Row[]> => ({ single: [{ upTo: "", rate: "" }], couple: [{ upTo: "", rate: "" }] });
const copyOf = (t: SlabTables): Record<TaxpayerClass, Row[]> => ({ single: toRows(t.single), couple: toRows(t.couple) });

/** One class's slabs, read only: where each slab starts, where it ends, and its rate. */
function SlabTable({ label, slabs }: { label: string; slabs: Slab[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{label}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--text-secondary)]">
          <tr>
            <th className="py-1 pr-2 font-medium">Income from</th>
            <th className="py-1 pr-2 font-medium">Up to</th>
            <th className="py-1 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {slabs.map((s, i) => (
            <tr key={i} className="border-t border-[var(--card-border)]">
              <td className="py-1 pr-2 tabular-nums">{money(i === 0 ? 0 : (slabs[i - 1].upTo ?? 0))}</td>
              <td className="py-1 pr-2 tabular-nums">{s.upTo === null ? "and above" : money(s.upTo)}</td>
              <td className="py-1 text-right tabular-nums">{s.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Where each slab starts and ends, and its rate, to edit: rows that differ from `base` are highlighted. */
function SlabEditor({ label, rows, base, onChange }: { label: string; rows: Row[]; base: Slab[] | undefined; onChange: (rows: Row[]) => void }) {
  const changed = changedSlabRows(base, rows);
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  // Adding a slab puts the open-ended one last: the old last slab gets a limit to fill in.
  const add = () => onChange([...rows, { upTo: "", rate: "" }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i).map((r, idx, all) => (idx === all.length - 1 ? { ...r, upTo: "" } : r)));
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{label}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--text-secondary)]">
          <tr>
            <th className="py-1 pr-2 font-medium">From</th>
            <th className="py-1 pr-2 font-medium">Up to</th>
            <th className="py-1 pr-2 font-medium">Rate %</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const last = i === rows.length - 1;
            return (
              <tr key={i} className={`border-t border-[var(--card-border)] ${changed[i] ? "bg-amber-50" : ""}`}>
                <td className="py-1 pr-2 tabular-nums text-[var(--text-secondary)]">{money(i === 0 ? 0 : Number(rows[i - 1].upTo) || 0)}</td>
                <td className="py-1 pr-2">{last ? <span className="text-[var(--text-secondary)]">and above</span> : <input type="number" min="0" value={r.upTo} onChange={(e) => set(i, { upTo: e.target.value })} className={`${adminField} w-28`} />}</td>
                <td className="py-1 pr-2">
                  <input type="number" min="0" max="100" step="0.01" value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} className={`${adminField} w-20`} />
                </td>
                <td className="py-1 text-right">
                  {rows.length > 1 && (
                    <button type="button" onClick={() => remove(i)} aria-label={`Remove slab ${i + 1}`} className="text-xs text-red-600 hover:underline">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={add} className="mt-1 text-xs text-[var(--color-primary)] hover:underline">
        + Add slab
      </button>
    </div>
  );
}

/** Salary-tax slabs of one heading (for example Payroll), for the fiscal year chosen on the screen. */
export function SlabsAdmin({ data, headKey, headName, fiscalYear }: { data: TaxRateAdminData; headKey: string; headName: string; fiscalYear: FiscalYear }) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notes, setNotes] = useState<{ id: string; isVerified: boolean; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  if (!data.country) return null;
  const country = data.country;

  const versions: SlabVersion[] = data.slabVersions[headKey] ?? [];
  const shown = versions.filter((v) => v.effectiveFrom >= fiscalYear.from && v.effectiveFrom <= fiscalYear.to);
  const yearVersion = versions.filter((v) => v.effectiveFrom <= fiscalYear.to).pop();
  const draft = data.slabDrafts.find((d) => d.headKey === headKey && d.effectiveFrom === fiscalYear.from);
  const before = versions.filter((v) => v.effectiveFrom < fiscalYear.from).pop() ?? versions[versions.length - 1];

  function open(from: Editor) {
    setMessage(null);
    setEditor(from);
  }

  async function save() {
    if (!editor) return;
    setBusy(true);
    setMessage(null);
    try {
      const tables = Object.fromEntries(TAXPAYER_CLASSES.map(({ key }) => [key, editor.rows[key].map((r, i, all) => ({ upTo: i === all.length - 1 ? null : r.upTo, rate: r.rate }))]));
      const r = editor.draftId
        ? await confirmSlabs({ draftId: editor.draftId, tables, effectiveFrom: editor.effectiveFrom, source: editor.source || "Carried forward and confirmed", isVerified: editor.isVerified })
        : await publishSlabs({ countryCode: country.code, headKey, effectiveFrom: editor.effectiveFrom, tables, source: editor.source, isVerified: editor.isVerified });
      if (!r.ok) setMessage({ tone: "bad", text: r.error });
      else {
        setEditor(null);
        setMessage({ tone: "ok", text: `Published. These slabs apply from ${editor.effectiveFrom}.` });
        router.refresh();
      }
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Could not publish the slabs." });
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    if (!notes) return;
    setBusy(true);
    try {
      const r = await editSlabNotes(notes);
      if (!r.ok) setMessage({ tone: "bad", text: r.error });
      else {
        setNotes(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const baseOf = (editing: Editor) => (editing.draftId ? before?.tables : (yearVersion ?? before)?.tables);

  return (
    <section className={`${adminCard} space-y-4 p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{headName} TDS slabs</h2>
          <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{yearVersion ? "Set" : "Not set"}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {yearVersion ? `Applies in ${fiscalYear.label} from ${bothDates(yearVersion.effectiveFrom < fiscalYear.from ? fiscalYear.from : yearVersion.effectiveFrom)} (v${yearVersion.version} of ${yearVersion.fiscalYear}).` : `No slabs are set for ${fiscalYear.label}.`}
          </p>
        </div>
        {!editor && (
          <button type="button" onClick={() => open({ draftId: null, effectiveFrom: "", source: "", isVerified: false, rows: yearVersion || before ? copyOf((yearVersion ?? before).tables) : blank() })} className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
            {yearVersion ? `Publish v${shown.length + 1}` : "Set the slabs"}
          </button>
        )}
      </div>

      {message && <p className={`rounded border px-3 py-2 text-sm ${message.tone === "ok" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{message.text}</p>}

      {draft && !editor && (
        <div className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm text-amber-900">
            <StatusPill tone="pending">Needs confirmation</StatusPill>
            <span>Carried forward from the previous year. Until you confirm, the earlier slabs keep applying.</span>
          </div>
          <button type="button" onClick={() => open({ draftId: draft.id, effectiveFrom: draft.effectiveFrom, source: "", isVerified: false, rows: copyOf(draft.tables) })} className="shrink-0 rounded border border-amber-400 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100">
            Review and confirm
          </button>
        </div>
      )}

      {editor && (
        <div className="space-y-3 rounded border border-[var(--card-border)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">{editor.draftId ? `Confirm the slabs for ${fiscalYear.label}` : yearVersion ? `New version for ${fiscalYear.label}` : `Slabs for ${fiscalYear.label}`}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--text-secondary)]">
              Starts on
              <input type="date" min={fiscalYear.from} max={fiscalYear.to} value={editor.effectiveFrom} onChange={(e) => setEditor({ ...editor, effectiveFrom: e.target.value })} className={`${adminField} mt-1 w-full`} />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Reason or source (optional)
              <input value={editor.source} onChange={(e) => setEditor({ ...editor, source: e.target.value })} placeholder="e.g. Finance Act 2083" className={`${adminField} mt-1 w-full`} />
            </label>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {TAXPAYER_CLASSES.map(({ key, label }) => (
              <SlabEditor key={key} label={label} rows={editor.rows[key]} base={baseOf(editor)?.[key]} onChange={(rows) => setEditor({ ...editor, rows: { ...editor.rows, [key]: rows } })} />
            ))}
          </div>
          {baseOf(editor) && <p className="text-xs text-[var(--text-secondary)]">Highlighted rows are different from the slabs they started as.</p>}
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={editor.isVerified} onChange={(e) => setEditor({ ...editor, isVerified: e.target.checked })} />
            A reviewer has confirmed these slabs against current law
          </label>
          <p className="text-xs text-[var(--text-secondary)]">Payroll in {country.name} uses these slabs from the start date. The earlier slabs end the day before.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !editor.effectiveFrom} onClick={save} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {busy ? "Publishing…" : editor.draftId ? "Confirm and publish" : "Publish"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditor(null)} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {yearVersion && !editor && (
        <div className="grid gap-4 lg:grid-cols-2">
          {TAXPAYER_CLASSES.map(({ key, label }) => (
            <SlabTable key={key} label={label} slabs={yearVersion.tables[key]} />
          ))}
        </div>
      )}

      {shown.length === 0 && !draft && yearVersion && <p className="text-sm text-[var(--text-secondary)]">No version starts in {fiscalYear.label}. v{yearVersion.version} of {yearVersion.fiscalYear} continues.</p>}

      {shown.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="py-1 pr-2 font-medium">Version</th>
              <th className="py-1 pr-2 font-medium">From</th>
              <th className="py-1 pr-2 font-medium">To</th>
              <th className="py-1 pr-2 font-medium">Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...shown].reverse().map((v) =>
              notes?.id === v.id ? (
                <tr key={v.id} className="border-t border-[var(--card-border)] align-top">
                  <td colSpan={5} className="space-y-2 py-2">
                    <input value={notes.source} onChange={(e) => setNotes({ ...notes, source: e.target.value })} placeholder="Source" className={`${adminField} w-full`} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={notes.isVerified} onChange={(e) => setNotes({ ...notes, isVerified: e.target.checked })} /> Verified against current law
                    </label>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={saveNotes} className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white disabled:opacity-50">
                        Save
                      </button>
                      <button type="button" onClick={() => setNotes(null)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={v.id} className="border-t border-[var(--card-border)] align-top">
                  <td className="py-1.5 pr-2 font-medium">
                    v{v.version} {v.inForce && <StatusPill tone="success">in force</StatusPill>}
                  </td>
                  <td className="py-1.5 pr-2 text-xs">{bothDates(v.effectiveFrom)}</td>
                  <td className="py-1.5 pr-2 text-xs">{v.effectiveTo ? bothDates(v.effectiveTo) : "—"}</td>
                  <td className="py-1.5 pr-2 text-xs">
                    {v.source ?? "—"} {v.isVerified ? <StatusPill tone="success">verified</StatusPill> : <StatusPill tone="pending">unverified</StatusPill>}
                  </td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => setNotes({ id: v.id, isVerified: v.isVerified, source: v.source ?? "" })} className="text-xs text-[var(--color-primary)] hover:underline">
                      Verify / source
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
