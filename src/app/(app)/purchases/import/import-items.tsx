"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { useProblem } from "@/components/problem-dialog";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { BILL_TYPE_LABEL, type PurchaseBillTypeValue } from "@/lib/purchases/import/values";
import type { ItemImportReview, ItemImportSettings } from "@/lib/purchases/import/item-service";
import { downloadItemTemplateAction, getItemImportSetup, importItemBillsAction, previewItemImportAction } from "./item-actions";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5 align-top";
const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CHUNK = 10;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Importing stockable purchases with their items: a row per item line, lines of the same invoice are one bill. The screen checks the file, shows every bill
// and what is wrong with it, and posts the ready ones a few at a time.
export function ImportItems() {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const fileInput = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [settings, setSettings] = useState<ItemImportSettings>({ defaultBillType: "no_bill", defaultAccountId: null, createSuppliers: true });
  const [review, setReview] = useState<ItemImportReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; failed: { invoiceNumber: string; error: string }[] } | null>(null);

  useEffect(() => {
    getItemImportSetup().then((s) => setAccounts(s.accounts)).catch(() => {});
  }, []);

  async function check(next: { name: string; base64: string }, s: ItemImportSettings) {
    setBusy(true);
    try {
      setReview(await previewItemImportAction({ fileName: next.name, base64: next.base64, settings: s }));
    } catch (e) {
      setReview(null);
      report(e instanceof Error ? e.message : "Could not read the file", null);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const next = { name: picked.name, base64: toBase64(await picked.arrayBuffer()) };
    setFile(next);
    setResult(null);
    await check(next, settings);
  }

  function change(patch: Partial<ItemImportSettings>) {
    const s = { ...settings, ...patch };
    setSettings(s);
    if (file) void check(file, s);
  }

  async function template() {
    try {
      const t = await downloadItemTemplateAction();
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

  async function run() {
    if (!file || !review) return;
    const keys = review.bills.filter((b) => b.status === "ready").map((b) => b.key);
    if (keys.length === 0) return;
    setBusy(true);
    setResult(null);
    let created = 0;
    const failed: { invoiceNumber: string; error: string }[] = [];
    try {
      for (let i = 0; i < keys.length; i += CHUNK) {
        setProgress({ done: i, total: keys.length });
        const r = await importItemBillsAction({ fileName: file.name, base64: file.base64, settings, keys: keys.slice(i, i + CHUNK) });
        created += r.created;
        failed.push(...r.failed);
      }
    } catch (e) {
      report(e instanceof Error ? e.message : "The import stopped", null);
    } finally {
      setProgress(null);
      setResult({ created, failed });
      setBusy(false);
      router.refresh();
    }
    // What was posted is no longer ready: check the file again so the list shows what is left.
    if (file) await check(file, settings);
  }

  const ready = review?.counts.ready ?? 0;
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2 p-3.5">
          <FileSpreadsheet size={22} className={file ? "text-[var(--success-text)]" : "text-ink-3"} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{file ? file.name : "Purchases with their items"}</p>
            <p className="text-xs text-ink-2">
              One row for each item bought; rows with the same supplier and invoice number are one bill.{" "}
              <button type="button" onClick={template} className="text-accent hover:underline">
                Download the template
              </button>
            </p>
          </div>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          <Button onClick={() => fileInput.current?.click()} loading={busy && !review}>
            {file ? "Replace file" : "Choose file"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Bill type when the file leaves it blank">
            <Select value={settings.defaultBillType} onChange={(e) => change({ defaultBillType: e.target.value as PurchaseBillTypeValue })}>
              {(Object.keys(BILL_TYPE_LABEL) as PurchaseBillTypeValue[]).map((k) => (
                <option key={k} value={k}>
                  {BILL_TYPE_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pay from, when the file names no account">
            <Select value={settings.defaultAccountId ?? ""} onChange={(e) => change({ defaultAccountId: e.target.value || null })}>
              <option value="">No default account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-1.5 text-[13px] text-ink">
            <input type="checkbox" checked={settings.createSuppliers} onChange={(e) => change({ createSuppliers: e.target.checked })} />
            Create suppliers that are not in your list
          </label>
        </div>
      </section>

      {result && (
        <div className={`rounded-lg border p-3 text-[13px] ${result.failed.length > 0 ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]" : "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"}`}>
          <p className="font-medium">{result.created} {result.created === 1 ? "bill" : "bills"} imported.</p>
          {result.failed.map((f) => (
            <p key={f.invoiceNumber}>
              {f.invoiceNumber}: {f.error}
            </p>
          ))}
        </div>
      )}

      {review && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <StatusPill tone="success">{ready} ready</StatusPill>
              {review.counts.problem > 0 && <StatusPill tone="critical">{review.counts.problem} with problems</StatusPill>}
              {review.counts.duplicate > 0 && <StatusPill tone="pending">{review.counts.duplicate} already recorded</StatusPill>}
              <span className="text-ink-2">
                {review.lines} lines, {money.format(review.total)} ready to import
              </span>
            </div>
            <Button variant="primary" onClick={run} loading={busy} disabled={ready === 0}>
              {progress ? `Importing ${progress.done} of ${progress.total}` : `Import ${ready} ${ready === 1 ? "bill" : "bills"}`}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>Date</th>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Lines</th>
                  <th className={`${th} text-right`}>VAT</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={th}>Check</th>
                </tr>
              </thead>
              <tbody>
                {review.bills.map((b) => (
                  <tr key={b.key} className="transition-colors hover:bg-hover">
                    <td className={td}>{b.invoiceNumber || "—"}</td>
                    <td className={td}>
                      {b.supplierName ?? "—"}
                      {b.newSupplier && <p className="text-xs text-ink-2">New supplier{b.similarTo ? `, looks like "${b.similarTo}"` : ""}</p>}
                    </td>
                    <td className={td}>{b.date ? <D value={b.date} /> : "—"}</td>
                    <td className={td}>{b.billType ? BILL_TYPE_LABEL[b.billType] : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{b.lines.length}</td>
                    <td className={`${td} text-right tabular-nums`}>{money.format(b.vat)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money.format(b.total)}</td>
                    <td className={td}>
                      {b.status === "ready" ? <StatusPill tone="success">Ready</StatusPill> : b.status === "duplicate" ? <StatusPill tone="pending">Already recorded</StatusPill> : <StatusPill tone="critical">Fix in the file</StatusPill>}
                      {b.issues.map((m, i) => (
                        <p key={i} className="mt-0.5 text-xs text-ink-2">
                          {m}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-3">A bill with a problem is left out. Correct the file and choose it again; bills already imported show as already recorded.</p>
        </section>
      )}
      {dialog}
    </div>
  );
}
