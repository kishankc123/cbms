"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { useProblem } from "@/components/problem-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Amount } from "@/components/ui/data-table";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { AmountInput } from "@/components/ui/amount-input";
import type { Preview } from "@/lib/suppliers/reconcile";
import type { Orientation } from "@/lib/suppliers/reconcile-rules";
import { createReconciliationAction, downloadStatementTemplateAction, previewStatementAction } from "./actions";

type Past = { id: string; vendorName: string; from: string; to: string; fileName: string; status: string; lines: number; matched: number };

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const MAP_FIELDS: { key: "date" | "reference" | "description" | "debit" | "credit" | "balance"; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "reference", label: "Document no." },
  { key: "description", label: "Particulars" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "balance", label: "Balance" },
];

export function ReconcileStart({ suppliers, initialSupplierId, today, canCreate, past }: { suppliers: { id: string; name: string }[]; initialSupplierId: string; today: string; canCreate: boolean; past: Past[] }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const fileInput = useRef<HTMLInputElement>(null);
  const [vendorId, setVendorId] = useState(initialSupplierId);
  const [from, setFrom] = useState(() => `${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("credit_is_bill");
  const [theirOpening, setTheirOpening] = useState("");
  const [theirClosing, setTheirClosing] = useState("");
  const [dateDays, setDateDays] = useState("7");
  const [amountTol, setAmountTol] = useState("1");
  const [busy, setBusy] = useState(false);

  async function read(next: { name: string; base64: string } | null, mapping?: Preview["mapping"], orient?: Orientation) {
    const f = next ?? file;
    if (!f) return;
    if (!vendorId) return report("Choose the supplier first.", null);
    if (!from || !to || from > to) return report("Choose the period: the start can't be after the end.", null);
    setBusy(true);
    try {
      const p = await previewStatementAction({ vendorId, from, to, fileName: f.name, base64: f.base64, mapping: mapping ?? null, orientation: orient ?? null });
      setPreview(p);
      setOrientation(p.orientation);
      setTheirOpening(String(p.theirOpening));
      setTheirClosing(String(p.theirClosing));
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not read the file", null);
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    try {
      const t = await downloadStatementTemplateAction();
      const bytes = Uint8Array.from(atob(t.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = t.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not download the template", null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const next = { name: picked.name, base64: toBase64(await picked.arrayBuffer()) };
    setFile(next);
    setPreview(null);
    await read(next);
  }

  async function start() {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const id = await createReconciliationAction({
        vendorId,
        from,
        to,
        fileName: file.name,
        base64: file.base64,
        mapping: preview.mapping,
        orientation,
        theirOpening: theirOpening === "" ? null : parseFloat(theirOpening),
        theirClosing: theirClosing === "" ? null : parseFloat(theirClosing),
        dateToleranceDays: parseInt(dateDays, 10) || 0,
        amountTolerance: parseFloat(amountTol) || 0,
      });
      router.push(`/suppliers/reconcile/${id}`);
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not start the reconciliation", null);
      setBusy(false);
    }
  }

  const setMap = (key: (typeof MAP_FIELDS)[number]["key"], value: string) => {
    if (!preview) return;
    const mapping = { ...preview.mapping, [key]: value || undefined };
    void read(null, mapping as Preview["mapping"], orientation);
  };

  return (
    <div className="space-y-4">
      {canCreate && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">New reconciliation</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier" required>
              <Select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPreview(null); }}>
                <option value="">Choose supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" required>
              <DatePicker id="rec-from" value={from} onChange={(v) => { setFrom(v); setPreview(null); }} className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px]" />
            </Field>
            <Field label="To" required>
              <DatePicker id="rec-to" value={to} onChange={(v) => { setTo(v); setPreview(null); }} className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px]" />
            </Field>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2 p-3.5">
            <FileSpreadsheet size={22} className={file ? "text-[var(--success-text)]" : "text-ink-3"} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{file ? file.name : "The supplier's statement"}</p>
              <p className="text-xs text-ink-2">{preview ? `${preview.rowsRead} rows read${preview.rowsSkipped > 0 ? `, ${preview.rowsSkipped} skipped (no date or no amount, such as an opening balance row)` : ""}, ${preview.inPeriod} in the period` : "An Excel (.xlsx) or CSV file, as the supplier sent it."}</p>
              {!preview && (
                <button type="button" onClick={downloadTemplate} className="mt-0.5 text-xs text-accent hover:underline">
                  Download the template to send to a supplier
                </button>
              )}
            </div>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
            <Button onClick={() => fileInput.current?.click()} loading={busy && !preview}>
              {file ? "Replace file" : "Choose file"}
            </Button>
          </div>

          {preview && (
            <div className="space-y-3 rounded-lg border border-line p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Check the columns</h3>
                {preview.problem ? <StatusPill tone="critical">{preview.problem}</StatusPill> : preview.inPeriod === 0 ? <StatusPill tone="critical">No rows in this period</StatusPill> : <StatusPill tone="success">{preview.inPeriod} rows in the period</StatusPill>}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {MAP_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Select value={preview.mapping[f.key] ?? ""} onChange={(e) => setMap(f.key, e.target.value)}>
                      <option value="">{f.key === "date" ? "Choose column" : "None"}</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>

              {preview.sample.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={th}>Date</th>
                        <th className={th}>Document no.</th>
                        <th className={th}>Particulars</th>
                        <th className={`${th} text-right`}>Debit</th>
                        <th className={`${th} text-right`}>Credit</th>
                        <th className={`${th} text-right`}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((r, i) => (
                        <tr key={i}>
                          <td className={td}><D value={r.date} /></td>
                          <td className={td}>{r.reference}</td>
                          <td className={td}>{r.description}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.debit ? r.debit.toFixed(2) : ""}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.credit ? r.credit.toFixed(2) : ""}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.balance === null ? "" : r.balance.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Which way round is the statement?" hint="A bill from the supplier is a credit on a statement written from your side, and a debit on the supplier's own books. The running balance is used to guess; change it if the guess is wrong.">
                  <Select
                    value={orientation}
                    onChange={(e) => {
                      const o = e.target.value as Orientation;
                      setOrientation(o);
                      void read(null, preview.mapping, o);
                    }}
                  >
                    <option value="credit_is_bill">Their credit is a bill to me</option>
                    <option value="debit_is_bill">Their debit is a bill to me</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Balance they show at the start">
                    <AmountInput bare type="number" step="0.01" value={theirOpening} onChange={(e) => setTheirOpening(e.target.value)} className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right text-[13px]" />
                  </Field>
                  <Field label="Balance they show at the end">
                    <AmountInput bare type="number" step="0.01" value={theirClosing} onChange={(e) => setTheirClosing(e.target.value)} className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right text-[13px]" />
                  </Field>
                </div>
              </div>
              <p className="text-xs text-ink-2">
                Your books show <span className="font-medium text-ink"><Amount value={preview.ourOpening} /></span> at the start and <span className="font-medium text-ink"><Amount value={preview.ourClosing} /></span> at the end of this period.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Match dates within (days)" hint="A payment recorded a few days either side of theirs is still suggested as the same one.">
                  <Input type="number" min="0" max="60" value={dateDays} onChange={(e) => setDateDays(e.target.value)} />
                </Field>
                <Field label="Match amounts within" hint="Allows for rounding. A bigger difference is shown as a difference, not matched.">
                  <Input type="number" min="0" step="0.01" value={amountTol} onChange={(e) => setAmountTol(e.target.value)} />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button variant="primary" loading={busy} disabled={Boolean(preview.problem) || preview.inPeriod === 0} onClick={start}>
                  Match with my books
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Past reconciliations</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Supplier</th>
                <th className={th}>Period</th>
                <th className={th}>File</th>
                <th className={`${th} text-right`}>Matched</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-hover">
                  <td className={td}>{r.vendorName}</td>
                  <td className={td}>
                    <D value={r.from} /> – <D value={r.to} />
                  </td>
                  <td className={`${td} text-ink-2`}>{r.fileName}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {r.matched} of {r.lines}
                  </td>
                  <td className={td}>{r.status === "reconciled" ? <StatusPill tone="success">Reconciled</StatusPill> : <StatusPill tone="pending">In progress</StatusPill>}</td>
                  <td className={`${td} text-right`}>
                    <Link href={`/suppliers/reconcile/${r.id}`} className="text-xs text-accent hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {past.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                    No reconciliations yet. Choose a supplier and upload their statement to start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {dialog}
    </div>
  );
}
