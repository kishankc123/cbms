import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { getPartyLines, buildStatement } from "./party-ledger";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysOverdue = (asOfStr: string, dueDateStr: string) =>
  Math.round((new Date(asOfStr + "T00:00:00Z").getTime() - new Date(dueDateStr + "T00:00:00Z").getTime()) / 86400000);

export type ReceivableAgeingRow = {
  customerId: string;
  accountId: string | null;
  name: string;
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  d90plus: number;
  /** Part of the customer's ledger balance not tied to any open invoice (opening balance, manual
   * journal vouchers, unapplied advances) — kept separate rather than silently dropped, so each row's
   * total always ties to that customer's actual receivable sub-account balance. */
  unapplied: number;
  total: number;
};

/**
 * Every customer's open invoices, bucketed by how overdue they are as of `asOf` (due date, or invoice
 * date if none was set). Bucket amounts are today's outstanding balance per invoice (total - amountPaid,
 * kept live by every receipt/return/advance application) — this is the customer's AR sub-ledger open
 * items, the standard basis for an ageing report, not a replay of ledger history as of a past date.
 */
export async function receivableAgeing(tenantId: string, asOf: Date) {
  const asOfStr = toDateStr(asOf);

  const customerRows = await db
    .select({ id: customers.id, name: customers.name, accountId: customers.receivableAccountId })
    .from(customers)
    .where(eq(customers.tenantId, tenantId));

  const invoiceRows = await db
    .select({ customerId: salesInvoices.customerId, dueDate: salesInvoices.dueDate, invoiceDate: salesInvoices.invoiceDate, total: salesInvoices.total, amountPaid: salesInvoices.amountPaid })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.tenantId, tenantId), ne(salesInvoices.status, "void")));

  type Buckets = { current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number; invoiceTotal: number };
  const byCustomer = new Map<string, Buckets>();
  const empty = (): Buckets => ({ current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, invoiceTotal: 0 });

  for (const inv of invoiceRows) {
    const outstanding = round2(Number(inv.total) - Number(inv.amountPaid));
    if (outstanding <= 0) continue;
    const dueDateStr = inv.dueDate ?? inv.invoiceDate;
    const b = byCustomer.get(inv.customerId) ?? empty();
    b.invoiceTotal = round2(b.invoiceTotal + outstanding);
    if (dueDateStr > asOfStr) b.current = round2(b.current + outstanding);
    else {
      const days = daysOverdue(asOfStr, dueDateStr);
      if (days <= 30) b.d1to30 = round2(b.d1to30 + outstanding);
      else if (days <= 60) b.d31to60 = round2(b.d31to60 + outstanding);
      else if (days <= 90) b.d61to90 = round2(b.d61to90 + outstanding);
      else b.d90plus = round2(b.d90plus + outstanding);
    }
    byCustomer.set(inv.customerId, b);
  }

  const accountIds = customerRows.map((c) => c.accountId).filter((x): x is string => Boolean(x));
  const linesByAccount = await getPartyLines(tenantId, accountIds);

  const rows: ReceivableAgeingRow[] = customerRows
    .map((c) => {
      const b = byCustomer.get(c.id) ?? empty();
      const lines = c.accountId ? linesByAccount.get(c.accountId) ?? [] : [];
      const ledgerBalance = buildStatement(lines, "debit", { to: asOfStr }).closingBalance;
      const unapplied = round2(ledgerBalance - b.invoiceTotal);
      const total = round2(b.current + b.d1to30 + b.d31to60 + b.d61to90 + b.d90plus + unapplied);
      return { customerId: c.id, accountId: c.accountId, name: c.name, current: b.current, d1to30: b.d1to30, d31to60: b.d31to60, d61to90: b.d61to90, d90plus: b.d90plus, unapplied, total };
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
