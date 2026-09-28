import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills } from "@/db/schema";
import { getPartyLines, buildStatement } from "./party-ledger";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysOverdue = (asOfStr: string, dueDateStr: string) =>
  Math.round((new Date(asOfStr + "T00:00:00Z").getTime() - new Date(dueDateStr + "T00:00:00Z").getTime()) / 86400000);

export type PayableAgeingRow = {
  vendorId: string;
  accountId: string | null;
  name: string;
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  d90plus: number;
  /** Part of the supplier's ledger balance not tied to any open bill (opening balance, manual journal
   * vouchers, unapplied advances) — kept separate rather than silently dropped, so each row's total
   * always ties to that supplier's actual payable sub-account balance. */
  unapplied: number;
  total: number;
};

/**
 * Every supplier's open purchase bills, bucketed by how overdue they are as of `asOf` (due date, or
 * bill date if none was set). The mirror of receivableAgeing() for the payable side — see that file
 * for the reasoning behind using today's outstanding-per-bill amount rather than a historical replay.
 */
export async function payableAgeing(tenantId: string, asOf: Date) {
  const asOfStr = toDateStr(asOf);

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name, accountId: vendors.payableAccountId })
    .from(vendors)
    .where(eq(vendors.tenantId, tenantId));

  const billRows = await db
    .select({ vendorId: purchaseBills.vendorId, dueDate: purchaseBills.dueDate, billDate: purchaseBills.billDate, total: purchaseBills.total, amountPaid: purchaseBills.amountPaid })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, tenantId), ne(purchaseBills.status, "void")));

  type Buckets = { current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number; billTotal: number };
  const byVendor = new Map<string, Buckets>();
  const empty = (): Buckets => ({ current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, billTotal: 0 });

  for (const bill of billRows) {
    if (!bill.vendorId) continue; // consumable purchase with no supplier chosen — nothing to age
    const outstanding = round2(Number(bill.total) - Number(bill.amountPaid));
    if (outstanding <= 0) continue;
    const dueDateStr = bill.dueDate ?? bill.billDate;
    const b = byVendor.get(bill.vendorId) ?? empty();
    b.billTotal = round2(b.billTotal + outstanding);
    if (dueDateStr > asOfStr) b.current = round2(b.current + outstanding);
    else {
      const days = daysOverdue(asOfStr, dueDateStr);
      if (days <= 30) b.d1to30 = round2(b.d1to30 + outstanding);
      else if (days <= 60) b.d31to60 = round2(b.d31to60 + outstanding);
      else if (days <= 90) b.d61to90 = round2(b.d61to90 + outstanding);
      else b.d90plus = round2(b.d90plus + outstanding);
    }
    byVendor.set(bill.vendorId, b);
  }

  const accountIds = vendorRows.map((v) => v.accountId).filter((x): x is string => Boolean(x));
  const linesByAccount = await getPartyLines(tenantId, accountIds);

  const rows: PayableAgeingRow[] = vendorRows
    .map((v) => {
      const b = byVendor.get(v.id) ?? empty();
      const lines = v.accountId ? linesByAccount.get(v.accountId) ?? [] : [];
      const ledgerBalance = buildStatement(lines, "credit", { to: asOfStr }).closingBalance;
      const unapplied = round2(ledgerBalance - b.billTotal);
      const total = round2(b.current + b.d1to30 + b.d31to60 + b.d61to90 + b.d90plus + unapplied);
      return { vendorId: v.id, accountId: v.accountId, name: v.name, current: b.current, d1to30: b.d1to30, d31to60: b.d31to60, d61to90: b.d61to90, d90plus: b.d90plus, unapplied, total };
    })
    .filter((r) => r.total !== 0)
    .sort((a, b) => b.total - a.total);

  const totals = rows.reduce(
    (acc, r) => ({
      current: round2(acc.current + r.current),
      d1to30: round2(acc.d1to30 + r.d1to30),
      d31to60: round2(acc.d31to60 + r.d31to60),
      d61to90: round2(acc.d61to90 + r.d61to90),
      d90plus: round2(acc.d90plus + r.d90plus),
      unapplied: round2(acc.unapplied + r.unapplied),
      total: round2(acc.total + r.total),
    }),
    { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, unapplied: 0, total: 0 }
  );

  return { asOf: asOfStr, rows, totals };
}
