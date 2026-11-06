"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { AssetsPanel, CalculationPanel } from "./calculation-panels";
import { ReportsPanel, ReviewPanel } from "./report-panels";
import { addTaxOpeningDeferred, addTaxStatutoryAddition, cancelTaxDeferred, saveTaxOpeningPool, setTaxCategoryClass, type TaxDepreciationSetupData } from "./actions";

const TABS = [
  { id: "calculation", label: "Calculation" },
  { id: "assets", label: "Asset tax details" },
  { id: "reports", label: "Reports" },
  { id: "review", label: "Review" },
  { id: "classes", label: "Asset classes" },
  { id: "opening", label: "Balances brought forward" },
  { id: "deferred", label: "Deferred additions" },
  { id: "statutory", label: "Statutory additions" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = "border-b border-line bg-app py-1.5 pr-3 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line py-2 pr-3 align-top";

export type Ready = TaxDepreciationSetupData & { rules: NonNullable<TaxDepreciationSetupData["rules"]> };

export function TaxDepreciationSetup({ data }: { data: TaxDepreciationSetupData }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("calculation");
  if (!data.rules) {
    return <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">No tax depreciation rules are published for your country yet, so there is nothing to set up. Your administrator can publish them.</p>;
  }
  const ready = data as Ready;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
              {t.label}{t.id === "review" && data.review.length > 0 && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2">{data.review.length}</span>}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Tax year
          <Select value={data.taxYear} onChange={(e) => router.push(`/assets/tax-depreciation?year=${e.target.value}`)} className="w-28">
            {data.years.map((y) => <option key={y.startYear} value={y.startYear}>{y.label}</option>)}
          </Select>
        </label>
      </div>

      {!data.isVerified && <p className="rounded-md border border-[var(--status-action-border)] bg-[var(--status-action-bg)] px-3 py-2 text-sm text-[var(--status-action-text)]">The published rates and rules have not been checked against current law yet. Treat figures calculated from them as provisional.</p>}
      {!data.canEdit && <p className="rounded bg-surface-2 px-3 py-2 text-xs text-ink-2">You can view these settings but not change them.</p>}

      {tab === "calculation" && <CalculationPanel data={ready} />}
      {tab === "assets" && <AssetsPanel data={ready} />}
      {tab === "reports" && <ReportsPanel data={ready} />}
      {tab === "review" && <ReviewPanel data={ready} go={setTab} />}
      {tab === "classes" && <ClassesPanel data={ready} />}
      {tab === "opening" && <OpeningPanel data={ready} />}
      {tab === "deferred" && <DeferredPanel data={ready} />}
      {tab === "statutory" && <StatutoryPanel data={ready} />}
    </div>
  );
}

function ClassesPanel({ data }: { data: Ready }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState<string | null>(null);
  async function change(categoryId: string, value: string) {
    setBusy(categoryId);
    try {
      const r = await setTaxCategoryClass({ categoryId, poolKey: value === "" ? null : value, taxYear: data.taxYear });
      if (!r.ok) return report(r.error);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      {dialog}
      <p className="text-sm text-ink-2">Each asset category is placed in a tax class. Assets follow their category; an asset that doesn&apos;t fit can be given its own class later. Categories the names could not place clearly are marked for review: confirm or change them.</p>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Category</th><th className={th}>Tax class</th><th className={th}>Why</th></tr></thead>
        <tbody>
          {data.categories.map((c) => (
            <tr key={c.categoryId}>
              <td className={td}>{c.name}</td>
              <td className={td}>
                <div className="flex items-center gap-2">
                  <Select disabled={!data.canEdit || busy === c.categoryId} value={c.poolKey ?? ""} onChange={(e) => change(c.categoryId, e.target.value)} className="w-72">
                    <option value="">No class (not depreciated for tax)</option>
                    {data.rules.pools.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </Select>
                  {c.needsReview && <StatusPill tone="action">Review</StatusPill>}
                </div>
              </td>
              <td className={`${td} text-xs text-ink-2`}>{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpeningPanel({ data }: { data: Ready }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [edit, setEdit] = useState<{ poolKey: string; assetId: string | null; label: string; value: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows: { poolKey: string; assetId: string | null; label: string }[] = [];
  for (const p of data.rules.pools) {
    if (p.kind === "pooled") rows.push({ poolKey: p.key, assetId: null, label: p.label });
    else for (const a of data.individualAssets.filter((x) => x.poolKey === p.key)) rows.push({ poolKey: p.key, assetId: a.id, label: `${a.label} (Class ${p.key})` });
  }
  const found = (poolKey: string, assetId: string | null) => data.openings.find((o) => o.poolKey === poolKey && o.assetId === assetId);

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const r = await saveTaxOpeningPool({ taxYear: data.taxYear, poolKey: edit.poolKey, assetId: edit.assetId, openingWdv: Number(edit.value), note: edit.note });
      if (!r.ok) return report(r.error);
      setEdit(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {dialog}
      <p className="text-sm text-ink-2">The written-down value of each class at the end of the previous tax year. Assets bought during this tax year before you started using Workdela are not included here: register them as this year&apos;s additions with their real dates.</p>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Class</th><th className={`${th} text-right`}>Brought forward</th><th className={th}>Note</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const o = found(r.poolKey, r.assetId);
            return (
              <tr key={`${r.poolKey}-${r.assetId ?? ""}`}>
                <td className={td}>{r.label}</td>
                <td className={`${td} text-right tabular-nums`}>{o ? money(o.openingWdv) : <span className="text-ink-2">Not entered</span>}</td>
                <td className={`${td} text-xs text-ink-2`}>{o?.note ?? ""}</td>
                <td className={`${td} text-right`}>{data.canEdit && <button type="button" onClick={() => setEdit({ ...r, value: o ? String(o.openingWdv) : "", note: o?.note ?? "" })} className="text-xs text-accent-text hover:underline">{o ? "Change" : "Enter"}</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.rules.pools.some((p) => p.kind === "individual") && data.individualAssets.length === 0 && <p className="text-xs text-ink-2">Intangible assets appear here once you have registered one.</p>}
      {edit && (
        <Modal title="Balance brought forward" description={edit.label} onClose={() => setEdit(null)} dismissible={!busy} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={edit.value === ""} onClick={save}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Written-down value at the start of the tax year"><Input type="number" min="0" step="0.01" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /></Field>
            <Field label="Note" hint="Where the figure comes from, for example last year's return."><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
            <p className="text-xs text-ink-2">You can correct this later. Every change is recorded in the audit log.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DeferredPanel({ data }: { data: Ready }) {
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const blank = { assetLabel: "", poolKey: data.rules.pools.find((p) => p.kind === "pooled")?.key ?? "", originalTaxYear: String(data.taxYear - 1), originalDate: "", originalCost: "", originalThirds: "2", includedInOriginalYear: "", remainingDeferred: "", dueTaxYear: String(data.taxYear), note: "" };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const thirds = (n: string) => (Number(n) === 1 ? 1 : Number(n) === 3 ? 3 : 2) as 1 | 2 | 3;

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const r = await addTaxOpeningDeferred({ assetId: null, assetLabel: form.assetLabel, poolKey: form.poolKey, originalTaxYear: Number(form.originalTaxYear), originalDate: form.originalDate, originalCost: Number(form.originalCost), originalThirds: thirds(form.originalThirds), includedInOriginalYear: Number(form.includedInOriginalYear || 0), remainingDeferred: Number(form.remainingDeferred), dueTaxYear: Number(form.dueTaxYear), note: form.note });
      if (!r.ok) return report(r.error);
      setForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string, label: string) {
    if (!(await ask(`Cancel the deferred amount for ${label}? It will no longer be included in any year.`, { danger: true, confirmLabel: "Cancel entry" }))) return;
    const r = await cancelTaxDeferred(id);
    if (!r.ok) return report(r.error);
    router.refresh();
  }
  const tone = { pending: "pending", included: "success", settled: "neutral", cancelled: "neutral" } as const;
  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-2">The part of an earlier year&apos;s addition that was held back by the timing rule and is added to a class in a later year. Enter the ones brought forward from before you started. Each is included once, in its due year.</p>
        {data.canEdit && <Button variant="primary" onClick={() => setForm(blank)}>Add deferred amount</Button>}
      </div>
      {data.deferred.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">Nothing is in the register.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Asset</th><th className={th}>Class</th><th className={th}>Acquired</th><th className={`${th} text-right`}>Cost</th><th className={th}>Timing</th><th className={`${th} text-right`}>Already included</th><th className={`${th} text-right`}>Deferred</th><th className={th}>Due year</th><th className={th}>Status</th><th /></tr></thead>
            <tbody>
              {data.deferred.map((d) => (
                <tr key={d.id}>
                  <td className={td}>{d.assetLabel}<div className="text-xs text-ink-2">{d.source === "opening" ? "Entered by hand" : "From a calculated year"}</div></td>
                  <td className={td}>{d.poolKey}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{d.originalDate}<div className="text-ink-2">Year {d.originalTaxYear}</div></td>
                  <td className={`${td} text-right tabular-nums`}>{money(d.originalCost)}</td>
                  <td className={td}>{d.originalThirds}/3</td>
                  <td className={`${td} text-right tabular-nums`}>{money(d.includedInOriginalYear)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(d.remainingDeferred)}</td>
                  <td className={td}>{d.dueTaxYear}</td>
                  <td className={td}><StatusPill tone={tone[d.status as keyof typeof tone] ?? "neutral"}>{d.status}</StatusPill></td>
                  <td className={`${td} text-right`}>{data.canVoid && d.status === "pending" && <button type="button" onClick={() => cancel(d.id, d.assetLabel)} className="text-xs text-ink-2 hover:text-ink hover:underline">Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal title="Deferred amount brought forward" onClose={() => setForm(null)} size="lg" dismissible={!busy} footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Asset" className="sm:col-span-2" required><Input value={form.assetLabel} onChange={(e) => setForm({ ...form, assetLabel: e.target.value })} placeholder="e.g. Laptops bought in Falgun" /></Field>
            <Field label="Tax class" required><Select value={form.poolKey} onChange={(e) => setForm({ ...form, poolKey: e.target.value })}>{data.rules.pools.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></Field>
            <Field label="Date acquired" required><Input type="date" value={form.originalDate} onChange={(e) => setForm({ ...form, originalDate: e.target.value })} /></Field>
            <Field label="Original tax year (starting year)" required><Input type="number" value={form.originalTaxYear} onChange={(e) => setForm({ ...form, originalTaxYear: e.target.value })} /></Field>
            <Field label="Due for inclusion in (starting year)" required><Input type="number" value={form.dueTaxYear} onChange={(e) => setForm({ ...form, dueTaxYear: e.target.value })} /></Field>
            <Field label="Original cost" required><Input type="number" min="0" step="0.01" value={form.originalCost} onChange={(e) => setForm({ ...form, originalCost: e.target.value })} /></Field>
            <Field label="Thirds counted in the original year"><Select value={form.originalThirds} onChange={(e) => setForm({ ...form, originalThirds: e.target.value })}><option value="3">3/3</option><option value="2">2/3</option><option value="1">1/3</option></Select></Field>
            <Field label="Already included in that year's pool"><Input type="number" min="0" step="0.01" value={form.includedInOriginalYear} onChange={(e) => setForm({ ...form, includedInOriginalYear: e.target.value })} /></Field>
            <Field label="Deferred amount still to include" required><Input type="number" min="0" step="0.01" value={form.remainingDeferred} onChange={(e) => setForm({ ...form, remainingDeferred: e.target.value })} /></Field>
            <Field label="Note" className="sm:col-span-2"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatutoryPanel({ data }: { data: Ready }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const blank = { poolKey: data.rules.pools.find((p) => p.kind === "pooled")?.key ?? "", typeKey: data.rules.statutoryAdditions[0]?.key ?? "", description: "", amount: "", legalReference: "", evidence: "" };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const type = (k: string) => data.rules.statutoryAdditions.find((t) => t.key === k);
  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const r = await addTaxStatutoryAddition({ taxYear: data.taxYear, poolKey: form.poolKey, typeKey: form.typeKey, description: form.description, amount: Number(form.amount), legalReference: form.legalReference, evidence: form.evidence });
      if (!r.ok) return report(r.error);
      setForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-2">Amounts the law adds to a class for this tax year, such as repair costs over the limit. Each needs the section of the law and the supporting evidence: there are no undocumented adjustments.</p>
        {data.canEdit && <Button variant="primary" onClick={() => setForm(blank)}>Add statutory addition</Button>}
      </div>
      {data.statutory.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">No statutory additions for this tax year.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Kind</th><th className={th}>Class</th><th className={th}>Description</th><th className={`${th} text-right`}>Amount</th><th className={th}>Law</th><th className={th}>Evidence</th></tr></thead>
          <tbody>
            {data.statutory.map((s) => (
              <tr key={s.id}>
                <td className={td}>{type(s.typeKey)?.label ?? s.typeKey}</td>
                <td className={td}>{s.poolKey}</td>
                <td className={td}>{s.description}</td>
                <td className={`${td} text-right tabular-nums`}>{money(s.amount)}</td>
                <td className={`${td} text-xs`}>{s.legalReference}</td>
                <td className={`${td} text-xs`}>{s.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {form && (
        <Modal title="Statutory addition" onClose={() => setForm(null)} size="lg" dismissible={!busy} footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind" required className="sm:col-span-2"><Select value={form.typeKey} onChange={(e) => setForm({ ...form, typeKey: e.target.value })}>{data.rules.statutoryAdditions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></Field>
            <Field label="Tax class" required><Select value={form.poolKey} onChange={(e) => setForm({ ...form, poolKey: e.target.value })}>{data.rules.pools.filter((p) => p.kind === "pooled").map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></Field>
            <Field label="Amount" required><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="What it is for" required className="sm:col-span-2"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Section of the law" hint={type(form.typeKey)?.legalReference ? `Leave empty to use: ${type(form.typeKey)?.legalReference}` : "Required for this kind."} className="sm:col-span-2"><Input value={form.legalReference} onChange={(e) => setForm({ ...form, legalReference: e.target.value })} /></Field>
            <Field label="Supporting evidence" required hint="A document, ledger account or report that backs the amount." className="sm:col-span-2"><Textarea rows={2} value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
