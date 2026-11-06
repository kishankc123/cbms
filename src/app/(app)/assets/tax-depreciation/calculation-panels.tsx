"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { finaliseTaxDepreciationYear, reopenTaxDepreciationYear, saveTaxAssetProfile, type TaxDepreciationSetupData } from "./actions";

type Ready = TaxDepreciationSetupData & { rules: NonNullable<TaxDepreciationSetupData["rules"]> };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = "border-b border-line bg-app py-1.5 pr-3 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line py-2 pr-3 align-top";

function Line({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-line py-1 text-sm ${strong ? "font-semibold text-ink" : ""}`}>
      <span className="text-ink-2">{label}{hint && <span className="ml-1 text-xs">({hint})</span>}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function CalculationPanel({ data }: { data: Ready }) {
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);
  const [reasonText, setReason] = useState<string | null>(null);
  const reason = reasonText ?? "";
  const calc = data.calc;
  if (!calc) return <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">{data.calcError ?? "Nothing to show for this tax year."}</p>;

  async function finalise() {
    if (!calc) return;
    const note = calc.rulesVerified ? "" : " The rules used are not yet verified against current law.";
    if (!(await ask(`Finalise tax year ${calc.label}? The figures and the rules used are saved, and the deferred amounts are registered for next year.${note}`, { confirmLabel: "Finalise" }))) return;
    setBusy(true);
    try {
      const r = await finaliseTaxDepreciationYear(calc.taxYear);
      if (!r.ok) return report(r.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    if (!calc) return;
    setBusy(true);
    try {
      const r = await reopenTaxDepreciationYear(calc.taxYear, reason);
      if (!r.ok) return report(r.error);
      setReason(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-2">Tax year {calc.label} ({calc.from} to {calc.to}). Worked out from your asset register, the balances brought forward, the deferred additions and the statutory additions. It never changes your books.</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-2">
            {calc.final ? <StatusPill tone="success">Finalised</StatusPill> : <StatusPill tone="pending">Preview</StatusPill>}
            {calc.rules.legalReference}
            {!calc.rulesVerified && <StatusPill tone="action">Rules not verified</StatusPill>}
          </p>
        </div>
        <div className="flex gap-2">
          {!calc.final && data.canEdit && <Button variant="primary" loading={busy} disabled={calc.blocking.length > 0 || calc.pools.length === 0} onClick={finalise}>Finalise year</Button>}
          {calc.final && data.canReopen && <Button loading={busy} onClick={() => setReason("")}>Reopen year</Button>}
        </div>
      </div>
      {reasonText !== null && (
        <Modal title={`Reopen tax year ${calc.label}`} description="The saved figures are kept as history. The year goes back to a live preview that you can correct and finalise again." onClose={() => setReason(null)} dismissible={!busy} footer={<><Button onClick={() => setReason(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={reopen}>Reopen year</Button></>}>
          <Field label="Reason" required hint="Recorded in the audit log."><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-4"><p className="text-xs text-ink-2">Tax depreciation deduction</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(calc.totals.totalDeduction)}</p></div>
        <div className="rounded-lg border border-line bg-surface p-4"><p className="text-xs text-ink-2">Balancing charge (taxable income)</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(calc.totals.balancingCharge)}</p></div>
        <div className="rounded-lg border border-line bg-surface p-4"><p className="text-xs text-ink-2">Terminal deduction (class closed)</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(calc.totals.terminalDeduction)}</p></div>
      </div>

      {calc.blocking.length > 0 && (
        <div className="rounded-md border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2 text-sm text-[var(--status-critical-text)]">
          <p className="font-medium">Fix these before finalising</p>
          <ul className="mt-1 list-disc pl-5">{calc.blocking.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {calc.warnings.length > 0 && (
        <div className="rounded-md border border-[var(--status-action-border)] bg-[var(--status-action-bg)] px-3 py-2 text-sm text-[var(--status-action-text)]">
          <ul className="list-disc pl-5">{calc.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {calc.pools.length === 0 && <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">No class has a balance, an addition or a disposal in this tax year yet. Enter the balances brought forward, or register assets with their dates.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {calc.pools.map((p) => {
          const r = p.result;
          return (
            <section key={`${p.key}-${p.assetId ?? ""}`} className="space-y-2 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{p.label}</h3>
                {r.dissolved ? <StatusPill tone="action">Class closed</StatusPill> : r.reviewFlags.length > 0 ? <StatusPill tone="pending">Review</StatusPill> : null}
              </div>
              <div>
                <Line label="Balance brought forward" value={money(r.openingWdv)} />
                <Line label="Additions counted this year" value={money(r.currentYearAdditions)} />
                <Line label="Deferred additions from earlier years" value={money(r.priorDeferredReceived)} />
                {r.statutoryAdditions > 0 && <Line label="Statutory additions" value={money(r.statutoryAdditions)} />}
                <Line label="Disposal proceeds" value={money(r.disposalProceeds)} />
                {!r.dissolved && <Line label="Base for depreciation" value={money(r.depreciationBase)} strong />}
                {!r.dissolved && <Line label="Rate" value={`${r.ratePercent}%`} />}
                {!r.dissolved && <Line label="Normal depreciation" value={money(r.normalDepreciation)} />}
                {r.additionalDepreciation > 0 && <Line label="Small-balance write-off" value={money(r.additionalDepreciation)} />}
                {r.sameYearDeductions > 0 && <Line label="Same-year concession deduction" value={money(r.sameYearDeductions)} />}
                {r.terminalDeduction > 0 && <Line label="Terminal deduction" value={money(r.terminalDeduction)} />}
                <Line label="Total deduction" value={money(r.totalDeduction)} strong />
                {r.balancingCharge > 0 && <Line label="Balancing charge (taxable income)" value={money(r.balancingCharge)} strong />}
                <Line label="Closing balance" value={money(r.closingWdv)} strong />
                {r.deferredCarriedForward > 0 && <Line label="Deferred to next year" value={money(r.deferredCarriedForward)} hint="joins next year's base" />}
              </div>
              {r.additionLines.length > 0 && (
                <table className="w-full text-xs">
                  <thead><tr><th className={th}>Addition</th><th className={th}>Date</th><th className={th}>Share</th><th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>This year</th><th className={`${th} text-right`}>Deferred</th></tr></thead>
                  <tbody>
                    {r.additionLines.map((l) => (
                      <tr key={l.id}><td className={td}>{l.label}</td><td className={td}>{l.date}</td><td className={td}>{l.thirds}/3</td><td className={`${td} text-right tabular-nums`}>{money(l.cost)}</td><td className={`${td} text-right tabular-nums`}>{money(l.currentYear)}</td><td className={`${td} text-right tabular-nums`}>{money(l.deferred)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {r.reviewFlags.length > 0 && <ul className="list-disc pl-5 text-xs text-ink-2">{r.reviewFlags.map((f) => <li key={f}>{f}</li>)}</ul>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

type Row = Ready["assetRows"][number];
type Form = { poolKeyOverride: string; enteredClassDate: string; costIncurredDate: string; periodOfUseYears: string; periodBasis: string; concessionKey: string; concessionConfirmed: boolean; concessionDocumentation: string; needsReview: boolean; reviewNote: string };

export function AssetsPanel({ data }: { data: Ready }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [edit, setEdit] = useState<{ row: Row; form: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const individual = new Set(data.rules.pools.filter((p) => p.kind === "individual").map((p) => p.key));
  const poolLabel = (k: string | null) => (k ? `Class ${k}` : "None");

  function open(row: Row) {
    setEdit({ row, form: { poolKeyOverride: row.override ?? "", enteredClassDate: row.enteredClassDate ?? "", costIncurredDate: row.costIncurredDate ?? "", periodOfUseYears: row.periodOfUseYears ? String(row.periodOfUseYears) : "", periodBasis: row.periodBasis, concessionKey: row.concessionKey ?? "", concessionConfirmed: row.concessionConfirmed, concessionDocumentation: row.concessionDocumentation, needsReview: row.needsReview, reviewNote: row.reviewNote } });
  }
  async function save() {
    if (!edit) return;
    const f = edit.form;
    setBusy(true);
    try {
      const r = await saveTaxAssetProfile({ assetId: edit.row.id, poolKeyOverride: f.poolKeyOverride || null, enteredClassDate: f.enteredClassDate || null, costIncurredDate: f.costIncurredDate || null, periodOfUseYears: f.periodOfUseYears ? Number(f.periodOfUseYears) : null, periodBasis: f.periodBasis, concessionKey: f.concessionKey || null, concessionConfirmed: f.concessionConfirmed, concessionDocumentation: f.concessionDocumentation, needsReview: f.needsReview, reviewNote: f.reviewNote, taxYear: data.taxYear });
      if (!r.ok) return report(r.error);
      setEdit(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const f = edit?.form;
  const effective = edit ? f!.poolKeyOverride || edit.row.categoryClass || "" : "";
  return (
    <div className="space-y-3">
      {dialog}
      <p className="text-sm text-ink-2">Each asset&apos;s tax details. By default an asset follows its category&apos;s class and counts from its available-for-use date. Change them here when the asset differs: a different class, the date it entered business use, the period of use of an intangible, or a concession.</p>
      {data.assetRows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">No assets are registered yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Asset</th><th className={th}>Category</th><th className={th}>Tax class</th><th className={th}>Counts from</th><th className={`${th} text-right`}>Cost</th><th className={th}>Flags</th><th /></tr></thead>
            <tbody>
              {data.assetRows.map((r) => {
                const from = r.enteredClassDate ?? r.availableForUseDate ?? r.purchaseDate;
                return (
                  <tr key={r.id}>
                    <td className={td}>{r.label}</td>
                    <td className={td}>{r.categoryName}</td>
                    <td className={td}>{poolLabel(r.classKey)} {r.override && <span className="text-xs text-ink-2">(own)</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{from ?? <StatusPill tone="critical">No date</StatusPill>}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(r.cost)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {r.needsReview && <StatusPill tone="action">Review</StatusPill>}
                        {r.concessionKey && <StatusPill tone={r.concessionConfirmed ? "pending" : "neutral"}>{r.concessionConfirmed ? "Concession" : "Concession not confirmed"}</StatusPill>}
                        {r.classKey && individual.has(r.classKey) && !r.periodOfUseYears && <StatusPill tone="critical">Period of use needed</StatusPill>}
                      </div>
                    </td>
                    <td className={`${td} text-right`}>{data.canEdit && <button type="button" onClick={() => open(r)} className="text-xs text-accent-text hover:underline">Tax details</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && f && (
        <Modal title="Tax details" description={edit.row.label} size="lg" onClose={() => setEdit(null)} dismissible={!busy} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tax class" hint={`Leave on the category's class (${poolLabel(edit.row.categoryClass)}) unless this asset differs.`} className="sm:col-span-2">
              <Select value={f.poolKeyOverride} onChange={(e) => setEdit({ ...edit, form: { ...f, poolKeyOverride: e.target.value } })}>
                <option value="">Follow the category</option>
                {data.rules.pools.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Date it entered business use" hint={`Empty uses the available-for-use date (${edit.row.availableForUseDate ?? edit.row.purchaseDate ?? "none"}).`}><Input type="date" value={f.enteredClassDate} onChange={(e) => setEdit({ ...edit, form: { ...f, enteredClassDate: e.target.value } })} /></Field>
            <Field label="Date the cost was incurred" hint="Empty uses the purchase date. The later of the two dates is used."><Input type="date" value={f.costIncurredDate} onChange={(e) => setEdit({ ...edit, form: { ...f, costIncurredDate: e.target.value } })} /></Field>
            {individual.has(effective) && (
              <>
                <Field label="Period of use (years)" required hint="Rounded to the nearest half year to give the rate."><Input type="number" min="0.5" step="0.5" value={f.periodOfUseYears} onChange={(e) => setEdit({ ...edit, form: { ...f, periodOfUseYears: e.target.value } })} /></Field>
                <Field label="What it is based on" required><Input value={f.periodBasis} onChange={(e) => setEdit({ ...edit, form: { ...f, periodBasis: e.target.value } })} placeholder="Contract, licence or law" /></Field>
              </>
            )}
            <Field label="Concession" hint="Off unless the legal conditions are met and confirmed below." className="sm:col-span-2">
              <Select value={f.concessionKey} onChange={(e) => setEdit({ ...edit, form: { ...f, concessionKey: e.target.value, concessionConfirmed: false } })}>
                <option value="">None</option>
                {data.rules.concessions.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
            {f.concessionKey && (
              <>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.concessionConfirmed} onChange={(e) => setEdit({ ...edit, form: { ...f, concessionConfirmed: e.target.checked } })} /> I confirm this asset meets the legal conditions for the concession</label>
                <Field label="Supporting documents" className="sm:col-span-2"><Input value={f.concessionDocumentation} onChange={(e) => setEdit({ ...edit, form: { ...f, concessionDocumentation: e.target.value } })} placeholder="Approval letter, certificate or invoice" /></Field>
              </>
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.needsReview} onChange={(e) => setEdit({ ...edit, form: { ...f, needsReview: e.target.checked } })} /> Mark for review (the class is uncertain)</label>
            <Field label="Review note" className="sm:col-span-2"><Textarea rows={2} value={f.reviewNote} onChange={(e) => setEdit({ ...edit, form: { ...f, reviewNote: e.target.value } })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
