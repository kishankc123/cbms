"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect } from "@/components/quick-add/pickers";
import { useProblem } from "@/components/problem-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Select, controlClass } from "@/components/ui/field";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { recordAmountPurchases, recordPendingPurchases, type AmountPurchaseRow, type CashBillType } from "./actions";
import { RecordPayModal } from "./record-pay-modal";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number; modeId?: string | null };

type Row = { billDate: string; vendorId: string; billNumber: string; billType: CashBillType; categoryId: string; description: string; amount: string; payments: PaymentLine[] };

const BILL_TYPES: { value: CashBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
  { value: "challan", label: "Challan" },
];

const MIN_ROWS = 7;
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = "px-1.5 py-1 align-top";
const small = "!px-2 !py-1 text-[13px]";

const touched = (r: Row) => Boolean(parseFloat(r.amount) > 0 || r.vendorId || r.billNumber.trim() || r.description.trim() || r.payments.length > 0);

// Many purchase bills at once, one per row, by their amount. It is for organizations that do not keep stock: there are no items to pick, and
// each bill is booked to the Purchases account (or one of its sub-accounts). Everything else (VAT, the supplier's balance, payments) is as on any bill.
export function AmountPurchaseGrid({ vendors: vendorsProp, categories, cashBankAccounts, vendorBalances, vatRate, pending = false, onDirtyChange }: { vendors: Vendor[]; categories: Account[]; cashBankAccounts: CashBankGroup[]; vendorBalances: Record<string, number>; vatRate: number; /** An organization that keeps stock: the purchases are stockable ones whose items are added later, so there is no category to choose. */ pending?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const defaultCategory = categories[0]?.id ?? "";
  const blank = (): Row => ({ billDate: todayIso(), vendorId: "", billNumber: "", billType: "no_bill", categoryId: defaultCategory, description: "", amount: "", payments: [] });
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: MIN_ROWS }, blank));
  const [paying, setPaying] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onDirtyChange?.(rows.some(touched));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const set = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const figures = (r: Row) => {
    const amount = parseFloat(r.amount) || 0;
    const vat = r.billType === "vat" ? Math.round(amount * vatRate) / 100 : 0;
    const total = Math.round((amount + vat) * 100) / 100;
    const paid = Math.round(r.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    return { amount, vat, total, paid };
  };
  const filled = rows.map((r, i) => ({ r, i })).filter(({ r }) => touched(r));
  const grandTotal = filled.reduce((s, { r }) => s + figures(r).total, 0);

  async function save() {
    if (filled.length === 0) return report("Enter at least one purchase.", null);
    for (const { r, i } of filled) {
      const f = figures(r);
      if (!r.billDate) return report(`Row ${i + 1}: enter the bill date.`, null);
      if (!(f.amount > 0)) return report(`Row ${i + 1}: enter the amount.`, null);
      if (!pending && !r.categoryId) return report(`Row ${i + 1}: choose where it is booked.`, null);
      if (f.paid - f.total > 0.004) return report(`Row ${i + 1}: the payment (${money(f.paid)}) can't be more than the bill total (${money(f.total)}).`, null);
      if (f.total - f.paid > 0.004 && !r.vendorId) return report(`Row ${i + 1}: choose a supplier. The unpaid ${money(f.total - f.paid)} is owed to them.`, null);
    }
    setSaving(true);
    try {
      const payload: AmountPurchaseRow[] = filled.map(({ r }) => ({ billDate: r.billDate, vendorId: r.vendorId, billNumber: r.billNumber.trim(), billType: r.billType, categoryId: r.categoryId, description: r.description.trim(), amount: parseFloat(r.amount) || 0, discount: 0, payments: r.payments }));
      const result = pending ? await recordPendingPurchases({ rows: payload }) : await recordAmountPurchases({ rows: payload });
      if (result.ok) {
        toast.success(`${result.saved} purchase${result.saved === 1 ? "" : "s"} recorded`);
        setRows(Array.from({ length: MIN_ROWS }, blank));
      } else {
        // The rows before the one that stopped are saved: leave only the rest on screen.
        const savedIdx = new Set(filled.slice(0, result.saved).map(({ i }) => i));
        setRows((prev) => {
          const left = prev.filter((_, i) => !savedIdx.has(i));
          return left.length >= MIN_ROWS ? left : [...left, ...Array.from({ length: MIN_ROWS - left.length }, blank)];
        });
        report(result.error, null);
      }
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the purchases", null);
    } finally {
      setSaving(false);
    }
  }

  const payingRow = paying !== null ? rows[paying] : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        {pending
          ? "Enter each purchase bill by its amount now and add the items later. The amount waits in Purchases awaiting item details, and stock does not change until you add the items on the bill. VAT is added for a VAT bill, and anything unpaid is owed to the supplier."
          : "Enter each purchase bill by its amount. There are no items to pick: the amount is booked to Purchases, VAT is added for a VAT bill, and anything unpaid is owed to the supplier."}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-1.5 py-1.5 font-medium">#</th>
              <th className="px-1.5 py-1.5 font-medium">Date</th>
              <th className="px-1.5 py-1.5 font-medium">Supplier</th>
              <th className="px-1.5 py-1.5 font-medium">Bill no.</th>
              <th className="px-1.5 py-1.5 font-medium">Bill type</th>
              {categories.length > 1 && <th className="px-1.5 py-1.5 font-medium">Booked to</th>}
              <th className="px-1.5 py-1.5 font-medium">Note</th>
              <th className="px-1.5 py-1.5 text-right font-medium">Amount</th>
              <th className="px-1.5 py-1.5 text-right font-medium">VAT</th>
              <th className="px-1.5 py-1.5 text-right font-medium">Total</th>
              <th className="px-1.5 py-1.5 font-medium">Payment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const f = figures(r);
              const unpaid = f.total - f.paid;
              return (
                <tr key={i} className="border-b border-line">
                  <td className={`${cell} pt-2 text-ink-3`}>{i + 1}</td>
                  <td className={cell}>
                    <DatePicker value={r.billDate} onChange={(v) => set(i, { billDate: v })} max={todayIso()} className={`${controlClass} ${small} w-36`} />
                  </td>
                  <td className={`${cell} w-48`}>
                    <SupplierSelect value={r.vendorId} options={vendors} onChange={(v) => set(i, { vendorId: v })} onAdded={addVendor} className={`${controlClass} ${small}`} />
                  </td>
                  <td className={cell}>
                    <Input value={r.billNumber} onChange={(e) => set(i, { billNumber: e.target.value })} placeholder="auto" className={`${small} w-28`} />
                  </td>
                  <td className={cell}>
                    <Select value={r.billType} onChange={(e) => set(i, { billType: e.target.value as CashBillType })} className={`${small} w-28`}>
                      {BILL_TYPES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  {categories.length > 1 && (
                    <td className={cell}>
                      <Select value={r.categoryId} onChange={(e) => set(i, { categoryId: e.target.value })} className={`${small} w-40`}>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                  )}
                  <td className={cell}>
                    <Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="optional" className={`${small} w-40`} />
                  </td>
                  <td className={cell}>
                    <Input type="number" step="0.01" min="0" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} className={`${small} w-28 text-right`} />
                  </td>
                  <td className={`${cell} pt-2 text-right tabular-nums text-ink-2`}>{f.vat > 0 ? money(f.vat) : "—"}</td>
                  <td className={`${cell} pt-2 text-right tabular-nums`}>{f.total > 0 ? money(f.total) : "—"}</td>
                  <td className={cell}>
                    <button type="button" disabled={!(f.total > 0)} onClick={() => setPaying(i)} className="whitespace-nowrap rounded-md border border-line-strong px-2 py-1 text-xs text-ink hover:bg-hover disabled:opacity-40">
                      {f.paid <= 0 ? "Record pay" : unpaid > 0.004 ? `Paid ${money(f.paid)}` : "Paid in full"}
                    </button>
                  </td>
                  <td className={`${cell} text-right`}>
                    {touched(r) && (
                      <button type="button" onClick={() => set(i, blank())} aria-label={`Clear row ${i + 1}`} className="text-xs text-ink-3 hover:text-red-600">
                        Clear
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setRows((prev) => [...prev, blank()])} className="text-[13px] text-accent hover:underline">
          + Add row
        </button>
        <div className="flex items-center gap-4">
          <p className="text-sm text-ink-2">
            {filled.length} purchase{filled.length === 1 ? "" : "s"} · total <span className="font-semibold tabular-nums text-ink">{money(grandTotal)}</span>
          </p>
          <Button variant="primary" onClick={save} loading={saving} disabled={filled.length === 0}>
            Save purchases
          </Button>
        </div>
      </div>

      {paying !== null && payingRow && (
        <RecordPayModal
          total={figures(payingRow).total}
          cashBankAccounts={cashBankAccounts}
          allVendors={vendors}
          vendorBalances={vendorBalances}
          initialVendorId={payingRow.vendorId}
          initialLines={payingRow.payments}
          saving={false}
          onCancel={() => setPaying(null)}
          onConfirm={(p, vendorId) => {
            set(paying, { payments: p, ...(vendorId ? { vendorId } : {}) });
            setPaying(null);
          }}
        />
      )}
      {dialog}
    </div>
  );
}
