import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers, expenses, purchaseBills, salesInvoices, vendors } from "@/db/schema";
import { emptyTotals, soonLimit, type BucketTotals, type DueBucket, type UpcomingItem, type UpcomingKind } from "./upcoming-rules";

export * from "./upcoming-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;

// What each kind of open document looks like to the database: the date it is due (or its own date when no due date was set), what is
// still unpaid, and the filter for the ones that count. Unposted drafts and voided documents are not money that is coming or going.
type Source = {
  due: SQL<string>;
  hasDue: SQL<boolean>;
  outstanding: SQL<string>;
  where: SQL;
};

const sources = (tenantId: string): Record<UpcomingKind, Source> => ({
  receivable: {
    due: sql<string>`coalesce(${salesInvoices.dueDate}, ${salesInvoices.invoiceDate})`,
    hasDue: sql<boolean>`${salesInvoices.dueDate} is not null`,
    outstanding: sql<string>`(${salesInvoices.total} - ${salesInvoices.amountPaid})`,
    where: and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"]), sql`(${salesInvoices.total} - ${salesInvoices.amountPaid}) > 0`)!,
  },
  bill: {
    due: sql<string>`coalesce(${purchaseBills.dueDate}, ${purchaseBills.billDate})`,
    hasDue: sql<boolean>`${purchaseBills.dueDate} is not null`,
    outstanding: sql<string>`(${purchaseBills.total} - ${purchaseBills.amountPaid})`,
    where: and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"]), sql`(${purchaseBills.total} - ${purchaseBills.amountPaid}) > 0`)!,
  },
  expense: {
    due: sql<string>`coalesce(${expenses.dueDate}, ${expenses.expenseDate})`,
    hasDue: sql<boolean>`${expenses.dueDate} is not null`,
    outstanding: sql<string>`(${expenses.amountPayable} - ${expenses.amountPaid})`,
    where: and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void"), sql`(${expenses.amountPayable} - ${expenses.amountPaid}) > 0`)!,
  },
});

const bucketSql = (due: SQL<string>, today: string, soon: string) =>
  sql<DueBucket>`case when ${due} < ${today}::date then 'overdue' when ${due} = ${today}::date then 'today' when ${due} <= ${soon}::date then 'soon' else 'scheduled' end`;

async function totalsFor(kind: UpcomingKind, tenantId: string, today: string): Promise<BucketTotals> {
  const s = sources(tenantId)[kind];
  const bucket = bucketSql(s.due, today, soonLimit(today));
  const table = kind === "receivable" ? salesInvoices : kind === "bill" ? purchaseBills : expenses;
  const rows = await db
    .select({ bucket, count: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${s.outstanding}), 0)` })
    .from(table)
    .where(s.where)
    .groupBy(sql`1`);
  const totals = emptyTotals();
  for (const r of rows) totals[r.bucket] = { count: Number(r.count), amount: round2(Number(r.amount)) };
  return totals;
}

export type UpcomingSummary = {
  /** What customers still owe us. */
  coming: BucketTotals;
  /** What we still owe suppliers, and expenses not yet paid. */
  going: BucketTotals;
  goingBills: BucketTotals;
  goingExpenses: BucketTotals;
};

const merge = (a: BucketTotals, b: BucketTotals): BucketTotals => {
  const out = emptyTotals();
  for (const k of Object.keys(out) as DueBucket[]) out[k] = { count: a[k].count + b[k].count, amount: round2(a[k].amount + b[k].amount) };
  return out;
}

/** Counts and totals per due-date bucket: three grouped queries (one per kind of document), however many documents there are. */
export async function upcomingSummary(tenantId: string, today: string): Promise<UpcomingSummary> {
  const [coming, goingBills, goingExpenses] = await Promise.all([totalsFor("receivable", tenantId, today), totalsFor("bill", tenantId, today), totalsFor("expense", tenantId, today)]);
  return { coming, going: merge(goingBills, goingExpenses), goingBills, goingExpenses };
}

export type UpcomingParty = {
  key: string;
  /** Whose ledger to open: a customer, a supplier, or only a name written on an expense (no ledger). */
  kind: "customer" | "supplier" | "payee";
  partyId: string | null;
  name: string;
  count: number;
  outstanding: number;
  /** The nearest (or most overdue) due date among this party's open documents. */
  earliestDue: string;
  items: UpcomingItem[];
};

type PartyAgg = Omit<UpcomingParty, "items">;

/**
 * One row per customer, supplier or payee with what they owe or are owed, most overdue first, and their documents for the
 * expanded view. Grouping happens in the database, and only the documents of the parties shown are loaded.
 */
export async function upcomingParties(tenantId: string, today: string, side: "coming" | "going", bucket: DueBucket | null, limit = 30): Promise<{ parties: UpcomingParty[]; hasMore: boolean }> {
  const soon = soonLimit(today);
  const filter = (due: SQL<string>): SQL | undefined => (bucket ? sql`${bucketSql(due, today, soon)} = ${bucket}` : undefined);
  const s = sources(tenantId);

  const receivableAgg = async (): Promise<PartyAgg[]> =>
    (
      await db
        .select({ id: customers.id, name: customers.name, count: sql<string>`count(*)`, amount: sql<string>`sum(${s.receivable.outstanding})`, earliest: sql<string>`min(${s.receivable.due})` })
        .from(salesInvoices)
        .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
        .where(and(s.receivable.where, filter(s.receivable.due)))
        .groupBy(customers.id, customers.name)
    ).map((r) => ({ key: `c:${r.id}`, kind: "customer", partyId: r.id, name: r.name, count: Number(r.count), outstanding: round2(Number(r.amount)), earliestDue: r.earliest }));

  const billAgg = async (): Promise<PartyAgg[]> =>
    (
      await db
        .select({ id: vendors.id, name: vendors.name, count: sql<string>`count(*)`, amount: sql<string>`sum(${s.bill.outstanding})`, earliest: sql<string>`min(${s.bill.due})` })
        .from(purchaseBills)
        .leftJoin(vendors, eq(vendors.id, purchaseBills.vendorId))
        .where(and(s.bill.where, filter(s.bill.due)))
        .groupBy(vendors.id, vendors.name)
    ).map((r) => ({ key: r.id ? `v:${r.id}` : "p:No supplier", kind: r.id ? "supplier" : "payee", partyId: r.id, name: r.name ?? "No supplier", count: Number(r.count), outstanding: round2(Number(r.amount)), earliestDue: r.earliest }));

  const expenseAgg = async (): Promise<PartyAgg[]> =>
    (
      await db
        .select({ id: vendors.id, vendor: vendors.name, payee: expenses.payeeName, count: sql<string>`count(*)`, amount: sql<string>`sum(${s.expense.outstanding})`, earliest: sql<string>`min(${s.expense.due})` })
        .from(expenses)
        .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
        .where(and(s.expense.where, filter(s.expense.due)))
        .groupBy(vendors.id, vendors.name, expenses.payeeName)
    ).map((r) => {
      const name = r.vendor ?? r.payee ?? "Other expenses";
      return { key: r.id ? `v:${r.id}` : `p:${name}`, kind: r.id ? "supplier" : "payee", partyId: r.id, name, count: Number(r.count), outstanding: round2(Number(r.amount)), earliestDue: r.earliest };
    });

  // A supplier with both bills and expenses is one row, and so is a payee name used on several expenses.
  const merged = new Map<string, PartyAgg>();
  for (const a of side === "coming" ? await receivableAgg() : (await Promise.all([billAgg(), expenseAgg()])).flat()) {
    const have = merged.get(a.key);
    merged.set(a.key, have ? { ...have, count: have.count + a.count, outstanding: round2(have.outstanding + a.outstanding), earliestDue: have.earliestDue < a.earliestDue ? have.earliestDue : a.earliestDue } : a);
  }
  const sorted = [...merged.values()].sort((a, b) => (a.earliestDue < b.earliestDue ? -1 : a.earliestDue > b.earliestDue ? 1 : b.outstanding - a.outstanding));
  const shown = sorted.slice(0, limit);
  const byKey = new Map(shown.map((p) => [p.key, { ...p, items: [] as UpcomingItem[] }]));

  // Documents, only for the parties on screen.
  const ids = (kind: "customer" | "supplier") => shown.filter((p) => p.kind === kind && p.partyId).map((p) => p.partyId!);
  const payees = shown.filter((p) => p.kind === "payee").map((p) => p.name);
  const push = (key: string, item: UpcomingItem) => byKey.get(key)?.items.push(item);

  if (side === "coming" && ids("customer").length) {
    const rows = await db
      .select({ id: salesInvoices.id, reference: salesInvoices.invoiceNumber, partyId: salesInvoices.customerId, due: s.receivable.due, hasDue: s.receivable.hasDue, outstanding: s.receivable.outstanding })
      .from(salesInvoices)
      .where(and(s.receivable.where, filter(s.receivable.due), inArray(salesInvoices.customerId, ids("customer"))))
      .orderBy(asc(s.receivable.due));
    for (const r of rows) push(`c:${r.partyId}`, { kind: "receivable", id: r.id, reference: r.reference, partyId: r.partyId, party: "", dueDate: r.due, hasDueDate: r.hasDue, outstanding: round2(Number(r.outstanding)) });
  }
  if (side === "going") {
    const supplierIds = ids("supplier");
    const [bills, exps] = await Promise.all([
      db
        .select({ id: purchaseBills.id, reference: purchaseBills.billNumber, partyId: purchaseBills.vendorId, due: s.bill.due, hasDue: s.bill.hasDue, outstanding: s.bill.outstanding })
        .from(purchaseBills)
        .where(and(s.bill.where, filter(s.bill.due), supplierIds.length ? inArray(purchaseBills.vendorId, supplierIds) : sql`${purchaseBills.vendorId} is null`)),
      db
        .select({ id: expenses.id, reference: expenses.expenseNumber, partyId: expenses.vendorId, payee: expenses.payeeName, due: s.expense.due, hasDue: s.expense.hasDue, outstanding: s.expense.outstanding })
        .from(expenses)
        .where(and(s.expense.where, filter(s.expense.due), or(supplierIds.length ? inArray(expenses.vendorId, supplierIds) : undefined, payees.length ? and(isNull(expenses.vendorId), inArray(sql<string>`coalesce(${expenses.payeeName}, 'Other expenses')`, payees)) : undefined))),
    ]);
    for (const r of bills) push(r.partyId ? `v:${r.partyId}` : "p:No supplier", { kind: "bill", id: r.id, reference: r.reference, partyId: r.partyId, party: "", dueDate: r.due, hasDueDate: r.hasDue, outstanding: round2(Number(r.outstanding)) });
    for (const r of exps) push(r.partyId ? `v:${r.partyId}` : `p:${r.payee ?? "Other expenses"}`, { kind: "expense", id: r.id, reference: r.reference, partyId: r.partyId, party: "", dueDate: r.due, hasDueDate: r.hasDue, outstanding: round2(Number(r.outstanding)) });
  }
  for (const p of byKey.values()) p.items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { parties: shown.map((p) => byKey.get(p.key)!), hasMore: sorted.length > limit };
}
