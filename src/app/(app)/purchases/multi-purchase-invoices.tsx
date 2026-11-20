"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useProblem } from "@/components/problem-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect, ItemSelect } from "@/components/quick-add/pickers";
import { DatePicker } from "@/components/calendar/date-picker";
import { AmountInput } from "@/components/ui/amount-input";
import { todayIso } from "@/lib/calendar";
import { invoiceRequirements } from "@/lib/purchases/invoice-requirements";
import { LINE_TREATMENTS, isTreatment, lineVatRate, type LineTreatment } from "@/lib/purchases/vat-lines";
import { createPurchaseInvoicesBatch, type CashBillType, type PurchaseInvoiceInput } from "./actions";

type Vendor = { id: string; name: string };
type Item = { id: string; name: string; purchasePrice: string; purchaseVatTreatment?: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

type Line = { itemId: string; rate: string; quantity: string; discount: string; taxTreatment: LineTreatment };
type Row = { id: number; date: string; vendorId: string; invoiceNumber: string; billType: CashBillType; accountId: string; lines: Line[]; open: boolean };

const BILL_TYPES: { value: CashBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyLine = (): Line => ({ itemId: "", rate: "", quantity: "", discount: "0", taxTreatment: "taxable" });
const complete = (l: Line) => Boolean(l.itemId && (parseFloat(l.rate) || 0) > 0 && (parseFloat(l.quantity) || 0) > 0);
const touched = (r: Row) => Boolean(r.vendorId || r.invoiceNumber.trim() || r.lines.some((l) => l.itemId || l.rate || l.quantity));

let nextId = 1;
const newRow = (date: string, open = false): Row => ({ id: nextId++, date, vendorId: "", invoiceNumber: "", billType: "no_bill", accountId: "", lines: [emptyLine()], open });

function totals(r: Row, vatRate: number) {
  let taxable = 0;
  let vat = 0;
  for (const l of r.lines.filter(complete)) {
    const gross = round2((parseFloat(l.rate) || 0) * (parseFloat(l.quantity) || 0));
    const net = round2(gross - Math.min(Math.max(parseFloat(l.discount) || 0, 0), gross));
    taxable += net;
    vat += round2(net * (lineVatRate(r.billType, l.taxTreatment, vatRate) / 100));
  }
  return { taxable: round2(taxable), vat: round2(vat), total: round2(taxable + vat) };
}

const cell = "w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-[13px] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

// Many invoices at once, a row each, with the items of a row opened beneath it. Saved one by one through the same writer as the single invoice form.
export function MultiPurchaseInvoices({
  vendors: vendorsProp,
  items: itemsProp,
  cashBankAccounts,
  vatRate,
  onDirtyChange,
}: {
  vendors: Vendor[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const [items, addItem] = useWithAdded(itemsProp);
  const [rows, setRows] = useState<Row[]>(() => [newRow(todayIso(), true), newRow(todayIso()), newRow(todayIso())]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onDirtyChange?.(rows.some(touched));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const accounts = cashBankAccounts.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }]));
  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const patchLine = (id: number, i: number, p: Partial<Line>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, lines: r.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) } : r)));
  const pickItem = (id: number, i: number, itemId: string, known?: Item) => {
    const item = known ?? items.find((it) => it.id === itemId);
    patchLine(id, i, { itemId, ...(item ? { rate: item.purchasePrice, taxTreatment: isTreatment(item.purchaseVatTreatment) ? item.purchaseVatTreatment : "taxable" } : {}) });
  };

  async function save() {
    const used = rows.filter(touched);
    if (used.length === 0) return report("Add at least one invoice.", null);
    const payload: PurchaseInvoiceInput[] = [];
    for (const [n, r] of used.entries()) {
      const label = `Invoice ${n + 1}`;
      const lines = r.lines.filter(complete);
      if (!r.date) return report(`${label}: enter the date.`, null);
      if (lines.length === 0) return report(`${label}: add at least one item with a rate and quantity.`, null);
      const t = totals(r, vatRate);
      const paid = r.accountId ? t.total : 0;
      const needs = invoiceRequirements({ billType: r.billType, total: t.total, paid });
      if (needs.numberRequired && !r.invoiceNumber.trim()) return report(`${label}: the invoice number is required: ${needs.reason}.`, null);
      if (needs.supplierRequired && !r.vendorId) return report(`${label}: select a supplier: ${needs.reason}.`, null);
      payload.push({
        invoiceNumber: r.invoiceNumber.trim(),
        invoiceDate: r.date,
        vendorId: r.vendorId,
        billType: r.billType,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          description: items.find((it) => it.id === l.itemId)?.name ?? "",
          rate: parseFloat(l.rate) || 0,
          quantity: parseFloat(l.quantity) || 0,
          discount: parseFloat(l.discount) || 0,
          ...(r.billType === "vat" && l.taxTreatment !== "taxable" ? { taxTreatment: l.taxTreatment } : {}),
        })),
        payments: r.accountId ? [{ accountId: r.accountId, amount: t.total }] : [],
      });
    }
    setSaving(true);
    try {
      const result = await createPurchaseInvoicesBatch(payload);
      router.refresh();
      if (result.ok) {
        toast.success(`${result.saved} ${result.saved === 1 ? "invoice" : "invoices"} saved.`);
        setRows([newRow(todayIso(), true), newRow(todayIso()), newRow(todayIso())]);
      } else {
        // The rows before the one that stopped are saved: take them off, leave the rest to fix.
        const savedIds = new Set(used.slice(0, result.saved).map((r) => r.id));
        setRows((rs) => rs.filter((r) => !savedIds.has(r.id)));
        report(`${result.saved > 0 ? `${result.saved} saved. ` : ""}${result.error}`, null);
      }
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save", null);
    } finally {
      setSaving(false);
    }
  }

  const grand = rows.filter(touched).reduce((s, r) => s + totals(r, vatRate).total, 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app [&_th]:px-1.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold">
            <tr>
              <th className="w-8" />
              <th>Date</th>
              <th>Supplier</th>
              <th>Invoice no.</th>
              <th>Bill type</th>
              <th className="!text-right">Taxable</th>
              <th className="!text-right">VAT</th>
              <th className="!text-right">Total</th>
              <th>Paid from</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = totals(r, vatRate);
              const count = r.lines.filter(complete).length;
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-line align-top">
                    <td className="px-1.5 py-1">
                      <button type="button" aria-label={r.open ? "Hide the items" : "Show the items"} onClick={() => patch(r.id, { open: !r.open })} className="mt-1 text-gray-500 hover:text-gray-900">
                        {r.open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="w-36 px-1 py-1">
                      <DatePicker id={`mp-date-${r.id}`} max={todayIso()} value={r.date} onChange={(v) => patch(r.id, { date: v })} className={cell} />
                    </td>
                    <td className="w-48 px-1 py-1">
                      <SupplierSelect value={r.vendorId} options={vendors} onChange={(id) => patch(r.id, { vendorId: id })} onAdded={addVendor} className={cell} />
                    </td>
                    <td className="w-32 px-1 py-1">
                      <input value={r.invoiceNumber} onChange={(e) => patch(r.id, { invoiceNumber: e.target.value })} className={cell} aria-label="Invoice number" />
                    </td>
                    <td className="w-28 px-1 py-1">
                      <select
                        value={r.billType}
                        onChange={(e) => {
                          const billType = e.target.value as CashBillType;
                          patch(r.id, { billType, ...(billType === "vat" ? {} : { lines: r.lines.map((l) => ({ ...l, taxTreatment: "taxable" as const })) }) });
                        }}
                        className={cell}
                      >
                        {BILL_TYPES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-700">{count ? fmt(t.taxable) : ""}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-700">{count ? fmt(t.vat) : ""}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{count ? fmt(t.total) : ""}</td>
                    <td className="w-44 px-1 py-1">
                      <select value={r.accountId} onChange={(e) => patch(r.id, { accountId: e.target.value })} className={cell} aria-label="Paid from">
                        <option value="">Unpaid</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <button type="button" aria-label="Remove this invoice" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : rs))} className="mt-1 text-gray-400 hover:text-red-600">
                        <X size={15} />
                      </button>
                    </td>
                  </tr>
                  {r.open && (
                    <tr className="border-b border-line bg-gray-50">
                      <td />
                      <td colSpan={9} className="px-2 py-2">
                        <table className="w-full text-[13px]">
                          <thead className="text-xs text-ink-2">
                            <tr>
                              <th className="px-1 py-1 text-left font-medium">Item</th>
                              <th className="px-1 py-1 text-left font-medium">Rate</th>
                              <th className="px-1 py-1 text-left font-medium">Qty</th>
                              <th className="px-1 py-1 text-left font-medium">Discount</th>
                              {r.billType === "vat" && <th className="px-1 py-1 text-left font-medium">VAT treatment</th>}
                              <th className="w-6" />
                            </tr>
                          </thead>
                          <tbody>
                            {r.lines.map((l, i) => (
                              <tr key={i}>
                                <td className="w-72 px-1 py-0.5">
                                  <ItemSelect
                                    value={l.itemId}
                                    options={items}
                                    placeholder="Select product"
                                    onChange={(id) => pickItem(r.id, i, id)}
                                    onAdded={(it) => {
                                      const item = { id: it.id, name: it.name, purchasePrice: it.purchasePrice };
                                      addItem(item);
                                      pickItem(r.id, i, it.id, item);
                                    }}
                                    className={cell}
                                  />
                                </td>
                                <td className="w-28 px-1 py-0.5">
                                  <AmountInput bare type="number" step="0.01" min="0" value={l.rate} onChange={(e) => patchLine(r.id, i, { rate: e.target.value })} className={cell} />
                                </td>
                                <td className="w-24 px-1 py-0.5">
                                  <AmountInput bare type="number" step="0.01" min="0" value={l.quantity} onChange={(e) => patchLine(r.id, i, { quantity: e.target.value })} className={cell} />
                                </td>
                                <td className="w-28 px-1 py-0.5">
                                  <AmountInput bare type="number" step="0.01" min="0" value={l.discount} onChange={(e) => patchLine(r.id, i, { discount: e.target.value })} className={cell} />
                                </td>
                                {r.billType === "vat" && (
                                  <td className="w-32 px-1 py-0.5">
                                    <select value={l.taxTreatment} onChange={(e) => patchLine(r.id, i, { taxTreatment: e.target.value as LineTreatment })} className={cell} aria-label="VAT treatment of this line">
                                      {LINE_TREATMENTS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                )}
                                <td className="px-1 py-0.5">
                                  <button type="button" aria-label="Remove this item" onClick={() => patch(r.id, { lines: r.lines.length > 1 ? r.lines.filter((_, k) => k !== i) : r.lines })} className="text-gray-400 hover:text-red-600">
                                    <X size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button type="button" onClick={() => patch(r.id, { lines: [...r.lines, emptyLine()] })} className="mt-1 text-xs text-gray-600 hover:text-gray-900">
                          + Add item
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.date ?? todayIso(), true)])} className="text-sm text-gray-600 hover:text-gray-900">
          + Add invoice
        </button>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-2">
            Total <span className="font-semibold tabular-nums text-ink">{fmt(round2(grand))}</span>
          </span>
          <Button variant="primary" onClick={save} loading={saving}>
            Save all
          </Button>
        </div>
      </div>
      <p className="text-xs text-ink-3">An invoice with a paid-from account is recorded as paid in full. Choose Unpaid to leave it owed to the supplier; record part payments from the single invoice form.</p>
      {dialog}
    </div>
  );
}
