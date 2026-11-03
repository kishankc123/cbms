import { and, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, items, journalEntries, journalLines, purchaseBills, salesInvoices } from "@/db/schema";
import { addDays, customerHabits, FALLBACK_COLLECTION_DAYS, settledInvoices, usualDaysToPay } from "./forecast";
import { CYCLE_DAYS, cycleOf, type Cycle, type CycleInputs, type SlowPayer } from "./cash-cycle-rules";

export * from "./cash-cycle-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

export type CashCycleData = {
  cycle: Cycle;
  inputs: CycleInputs;
  from: string;
  to: string;
  /** How long settled invoices actually took to be paid, from the last 6 months. Null until some have been settled. */
  actualDaysToPay: number | null;
  slowPayers: SlowPayer[];
};

/**
 * The cash conversion cycle from the last 90 days: a handful of sums (sales, purchases, cost of sales, what is owed each way, stock held)
 * and the 6-month payment history, all read straight from invoices, bills, stock and the ledger.
 */
export async function loadCashCycle(tenantId: string, today: string): Promise<CashCycleData> {
  const from = addDays(today, -(CYCLE_DAYS - 1));
  const openInvoice = and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"]), sql`(${salesInvoices.total} - ${salesInvoices.amountPaid}) > 0`);
  const openBill = and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"]), sql`(${purchaseBills.total} - ${purchaseBills.amountPaid}) > 0`);

  const [[sales], [purchases], [receivables], [payables], [stock], [cogs], history] = await Promise.all([
    db
      .select({ v: sql<string>`coalesce(sum(${salesInvoices.total}), 0)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue", "paid"]), gte(salesInvoices.invoiceDate, from), lte(salesInvoices.invoiceDate, today))),
    // Only credit bills: cash purchases are paid on the spot and asset purchases are not trading stock.
    db
      .select({ v: sql<string>`coalesce(sum(${purchaseBills.total}), 0)` })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.purchaseType, "credit"), inArray(purchaseBills.status, ["open", "partially_paid", "overdue", "paid"]), gte(purchaseBills.billDate, from), lte(purchaseBills.billDate, today))),
    db.select({ v: sql<string>`coalesce(sum(${salesInvoices.total} - ${salesInvoices.amountPaid}), 0)` }).from(salesInvoices).where(openInvoice),
    db.select({ v: sql<string>`coalesce(sum(${purchaseBills.total} - ${purchaseBills.amountPaid}), 0)` }).from(purchaseBills).where(and(openBill, eq(purchaseBills.purchaseType, "credit"))),
    db.select({ v: sql<string>`coalesce(sum(${items.stockValue}), 0)` }).from(items).where(and(eq(items.tenantId, tenantId), eq(items.inventoryTracking, true))),
    db
      .select({ debit: sql<string>`coalesce(sum(${journalLines.debitAmount}), 0)`, credit: sql<string>`coalesce(sum(${journalLines.creditAmount}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(and(eq(journalEntries.tenantId, tenantId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, today), or(eq(accounts.code, "5000"), like(accounts.code, "5000.%")))),
    settledInvoices(tenantId, today),
  ]);

  const inputs: CycleInputs = {
    receivables: round2(num(receivables?.v)),
    sales: round2(num(sales?.v)),
    stock: round2(num(stock?.v)),
    costOfSales: round2(Math.max(num(cogs?.debit) - num(cogs?.credit), 0)),
    payables: round2(num(payables?.v)),
    purchases: round2(num(purchases?.v)),
    days: CYCLE_DAYS,
  };

  // Customers who take longest against the day they were meant to pay (their due date, or invoice date plus the usual days).
  const usual = usualDaysToPay(history);
  const habits = customerHabits(history, usual ?? FALLBACK_COLLECTION_DAYS);
  const slow = [...habits.entries()].filter(([, h]) => h.lagDays > 0).sort((a, b) => b[1].lagDays - a[1].lagDays).slice(0, 5);
  const names = slow.length ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.tenantId, tenantId), inArray(customers.id, slow.map(([id]) => id)))) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  return {
    cycle: cycleOf(inputs),
    inputs,
    from,
    to: today,
    actualDaysToPay: usual,
    slowPayers: slow.map(([customerId, h]) => ({ customerId, name: nameOf.get(customerId) ?? "Customer", invoices: h.samples, daysLate: h.lagDays })),
  };
}
