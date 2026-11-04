import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers, expenses, purchaseBills, salesInvoices, vendors } from "@/db/schema";
import { pendingCheques } from "@/lib/cheques/pending";
import { emptyTotals, soonLimit, type BucketTotals, type DueBucket, type UpcomingItem, type UpcomingKind, type UpcomingParty } from "./upcoming-rules";

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

type PartyAgg = UpcomingParty;

/**
 * One row per customer, supplier or payee with what they owe or are owed, most overdue first. Grouping happens in the database;
 * a party's own documents are only loaded when its row is opened (see upcomingDocuments).
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
  if (side === "going" && shown.some((p) => p.kind === "supplier")) {
    // Cheques already written for a supplier cover their bills from the oldest; say how much of the balance is already promised.
    const byVendor = new Map<string, number>();
    for (const c of await pendingCheques(tenantId)) if (c.payeeKind === "supplier" && c.vendorId) byVendor.set(c.vendorId, round2((byVendor.get(c.vendorId) ?? 0) + c.amount));
    for (const p of shown) {
      const covered = p.kind === "supplier" && p.partyId ? byVendor.get(p.partyId) : undefined;
      if (covered) p.chequeCovered = Math.min(covered, p.outstanding);
    }
  }
  return { parties: shown, hasMore: sorted.length > limit };
}

/** One party's open documents, oldest due first, for when its row is opened. At most `limit` come back, and `hasMore` says if there were others. */
export async function upcomingDocuments(tenantId: string, today: string, side: "coming" | "going", partyKey: string, bucket: DueBucket | null, limit = 50): Promise<{ items: UpcomingItem[]; hasMore: boolean }> {
  const soon = soonLimit(today);
  const filter = (due: SQL<string>): SQL | undefined => (bucket ? sql`${bucketSql(due, today, soon)} = ${bucket}` : undefined);
  const s = sources(tenantId);
  const [prefix, ...rest] = partyKey.split(":");
  const ref = rest.join(":");
  const take = limit + 1;

  const items: UpcomingItem[] = [];
  if (side === "coming" && prefix === "c") {
    const rows = await db
      .select({ id: salesInvoices.id, reference: salesInvoices.invoiceNumber, due: s.receivable.due, hasDue: s.receivable.hasDue, outstanding: s.receivable.outstanding })
      .from(salesInvoices)
      .where(and(s.receivable.where, filter(s.receivable.due), eq(salesInvoices.customerId, ref)))
      .orderBy(asc(s.receivable.due))
      .limit(take);
    for (const r of rows) items.push({ kind: "receivable", id: r.id, reference: r.reference, partyId: ref, party: "", dueDate: r.due, hasDueDate: r.hasDue, outstanding: round2(Number(r.outstanding)) });
  } else if (side === "going" && (prefix === "v" || prefix === "p")) {
    const [bills, exps] = await Promise.all([
      db
        .select({ id: purchaseBills.id, reference: purchaseBills.billNumber, due: s.bill.due, hasDue: s.bill.hasDue, outstanding: s.bill.outstanding })
        .from(purchaseBills)
        .where(and(s.bill.where, filter(s.bill.due), prefix === "v" ? eq(purchaseBills.vendorId, ref) : isNull(purchaseBills.vendorId)))
        .orderBy(asc(s.bill.due))
        .limit(take),
      prefix === "v" || ref !== "No supplier"
        ? db
            .select({ id: expenses.id, reference: expenses.expenseNumber, due: s.expense.due, hasDue: s.expense.hasDue, outstanding: s.expense.outstanding })
            .from(expenses)
            .where(and(s.expense.where, filter(s.expense.due), prefix === "v" ? eq(expenses.vendorId, ref) : and(isNull(expenses.vendorId), sql`coalesce(${expenses.payeeName}, 'Other expenses') = ${ref}`)))
            .orderBy(asc(s.expense.due))
            .limit(take)
        : Promise.resolve([]),
    ]);
    const partyId = prefix === "v" ? ref : null;
    for (const r of bills) items.push({ kind: "bill", id: r.id, reference: r.reference, partyId, party: "", dueDate: r.due, hasDueDate: r.hasDue, outstanding: round2(Number(r.outstanding)) });
    for (const r of exps) items.push({ kind: "expense", id: r.id, reference: r.reference, partyId, party: "", dueDate: r.due, hasDueDate: r.hasDue, outstanding: round2(Number(r.outstanding)) });
  }
  items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}
