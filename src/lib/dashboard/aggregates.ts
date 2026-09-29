import { and, eq, ne, gte, lte, inArray, notInArray, or, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, salesInvoices, purchaseBills, items, inventorySettings, complianceObligations } from "@/db/schema";
import { effectiveStatus, summarize as summarizeCompliance, type EffectiveStatus } from "@/lib/compliance/engine/status";

/**
 * Purpose-built aggregate queries for the Dashboard — each one pushes SUM/GROUP BY into
 * Postgres and returns a small, page-ready shape, rather than the dashboard calling
 * profitAndLoss/balanceSheet/trialBalance (src/lib/ledger/reports.ts) once per widget,
 * which pulls every journal line for the tenant into JS on every call. Those report
 * functions remain the source of truth for the Reports module itself; this file exists
 * only so the dashboard doesn't multiply that cost by the number of widgets on the page.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | null | undefined) => Number(v ?? 0);
const daysBetweenIso = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000);

// Same "1000 Cash" / "1010 Bank" code convention as reports.ts's cashBook/cashBankMovement.
const isCashCode = (code: string) => code === "1000" || code.startsWith("1000.");

// ---------------------------------------------------------------- KPIs

export type DashboardKpis = {
  revenue: number;
  revenueTrendPct: number | null;
  expenses: number;
  expenseTrendPct: number | null;
  netProfit: number;
  netProfitTrendPct: number | null;
};

async function incomeExpenseTotals(tenantId: string, from: string, to: string): Promise<{ income: number; expenses: number }> {
  const rows = await db
    .select({
      category: accounts.category,
      debit: sql<string>`sum(${journalLines.debitAmount})`,
      credit: sql<string>`sum(${journalLines.creditAmount})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalEntries.tenantId, tenantId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to), inArray(accounts.category, ["income", "expense"])))
    .groupBy(accounts.category);

  let income = 0;
  let expenses = 0;
  for (const r of rows) {
    const debit = num(r.debit);
    const credit = num(r.credit);
    if (r.category === "income") income += credit - debit;
    else expenses += debit - credit;
  }
  return { income: round2(income), expenses: round2(expenses) };
}

const pctChange = (curr: number, prev: number): number | null => (prev === 0 ? null : round2(((curr - prev) / Math.abs(prev)) * 100));

/**
 * `range` is the period to report on (e.g. the active fiscal year's default range, or "this
 * month") — trend is against the immediately preceding period of the same length, so a
 * 1-month range compares to the prior month and a full-year range compares to the prior year.
 */
export async function dashboardKpis(tenantId: string, range: { from: string; to: string }): Promise<DashboardKpis> {
  const spanDays = daysBetweenIso(range.from, range.to) + 1;
  const prevTo = new Date(new Date(range.from + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(prevTo + "T00:00:00Z").getTime() - (spanDays - 1) * 86_400_000).toISOString().slice(0, 10);

  const [current, previous] = await Promise.all([incomeExpenseTotals(tenantId, range.from, range.to), incomeExpenseTotals(tenantId, prevFrom, prevTo)]);

  const netProfit = round2(current.income - current.expenses);
  const prevNetProfit = round2(previous.income - previous.expenses);

  return {
    revenue: current.income,
    revenueTrendPct: pctChange(current.income, previous.income),
    expenses: current.expenses,
    expenseTrendPct: pctChange(current.expenses, previous.expenses),
    netProfit,
    netProfitTrendPct: pctChange(netProfit, prevNetProfit),
  };
}

// ---------------------------------------------------------- Cash & Bank

export type CashBankAccountBalance = { accountId: string; code: string; name: string; kind: "cash" | "bank"; balance: number };

export async function cashAndBankBreakdown(tenantId: string, asOfIso: string): Promise<{ total: number; accounts: CashBankAccountBalance[] }> {
  const cashBankAccounts = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.isActive, true),
        or(eq(accounts.code, "1000"), like(accounts.code, "1000.%"), eq(accounts.code, "1010"), like(accounts.code, "1010.%"))
      )
    );
  if (cashBankAccounts.length === 0) return { total: 0, accounts: [] };

  const accountIds = cashBankAccounts.map((a) => a.id);
  const rows = await db
    .select({
      accountId: journalLines.accountId,
      debit: sql<string>`sum(${journalLines.debitAmount})`,
      credit: sql<string>`sum(${journalLines.creditAmount})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds), lte(journalEntries.entryDate, asOfIso)))
    .groupBy(journalLines.accountId);

  const balanceByAccount = new Map(rows.map((r) => [r.accountId, round2(num(r.debit) - num(r.credit))]));

  const accountRows: CashBankAccountBalance[] = cashBankAccounts
    .map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      kind: isCashCode(a.code) ? ("cash" as const) : ("bank" as const),
      balance: balanceByAccount.get(a.id) ?? 0,
    }))
    .sort((a, b) => (a.kind === b.kind ? b.balance - a.balance : a.kind === "cash" ? -1 : 1));

  return { total: round2(accountRows.reduce((s, a) => s + a.balance, 0)), accounts: accountRows };
}

// --------------------------------------------------- Revenue/expense trend

export type MonthlyTrendPoint = { monthStart: string; monthEnd: string; revenue: number; expenses: number };

/** Buckets by AD calendar month (see calendar/service.ts: AD is the only canonical date form — BS is display-only), ending in the AD month containing `asOfIso`. */
export async function revenueExpenseTrend(tenantId: string, monthsBack: number, asOfIso: string): Promise<MonthlyTrendPoint[]> {
  const [y, m] = asOfIso.split("-").map(Number);
  const points = Array.from({ length: monthsBack }, (_, idx) => {
    const i = monthsBack - 1 - idx;
    const start = new Date(Date.UTC(y, m - 1 - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return { key: start.toISOString().slice(0, 7), monthStart: start.toISOString().slice(0, 10), monthEnd: end.toISOString().slice(0, 10) };
  });

  const rows = await db
    .select({
      month: sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`,
      category: accounts.category,
      debit: sql<string>`sum(${journalLines.debitAmount})`,
      credit: sql<string>`sum(${journalLines.creditAmount})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        gte(journalEntries.entryDate, points[0].monthStart),
        lte(journalEntries.entryDate, points[points.length - 1].monthEnd),
        inArray(accounts.category, ["income", "expense"])
      )
    )
    .groupBy(sql`to_char(${journalEntries.entryDate}, 'YYYY-MM')`, accounts.category);

  const byMonth = new Map<string, { revenue: number; expenses: number }>();
  for (const r of rows) {
    const bucket = byMonth.get(r.month) ?? { revenue: 0, expenses: 0 };
    if (r.category === "income") bucket.revenue += num(r.credit) - num(r.debit);
    else bucket.expenses += num(r.debit) - num(r.credit);
    byMonth.set(r.month, bucket);
  }

  return points.map((p) => {
    const b = byMonth.get(p.key) ?? { revenue: 0, expenses: 0 };
    return { monthStart: p.monthStart, monthEnd: p.monthEnd, revenue: round2(b.revenue), expenses: round2(b.expenses) };
  });
}

// ------------------------------------------------------- Expense breakdown

export type ExpenseCategoryAmount = { accountId: string; code: string; name: string; amount: number };

export async function expenseBreakdown(
  tenantId: string,
  range: { from: string; to: string },
  opts: { topN?: number } = {}
): Promise<{ categories: ExpenseCategoryAmount[]; otherAmount: number; total: number }> {
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      debit: sql<string>`sum(${journalLines.debitAmount})`,
      credit: sql<string>`sum(${journalLines.creditAmount})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(accounts.category, "expense"), gte(journalEntries.entryDate, range.from), lte(journalEntries.entryDate, range.to)))
    .groupBy(accounts.id, accounts.code, accounts.name);

  const all = rows
    .map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, amount: round2(num(r.debit) - num(r.credit)) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  const topN = opts.topN ?? 5;
  const categories = all.slice(0, topN);
  const otherAmount = round2(all.slice(topN).reduce((s, r) => s + r.amount, 0));
  const total = round2(all.reduce((s, r) => s + r.amount, 0));

  return { categories, otherAmount, total };
}

// ------------------------------------------------------------ Needs Attention

export type NeedsAttentionItem = {
  id: "trial_balance" | "draft_invoices" | "draft_bills" | "negative_stock" | "overdue_receivables";
  label: string;
  detail: string;
  severity: "critical" | "action";
  count?: number;
  amount?: number;
};

export async function needsAttention(tenantId: string, asOfIso: string): Promise<NeedsAttentionItem[]> {
  const [tbRow, draftInvoiceRow, draftBillRow, [invSettings], negativeStockRows, overdueRow] = await Promise.all([
    db
      .select({ debit: sql<string>`sum(${journalLines.debitAmount})`, credit: sql<string>`sum(${journalLines.creditAmount})` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(eq(journalEntries.tenantId, tenantId), lte(journalEntries.entryDate, asOfIso)))
      .then((r) => r[0]),
    db
      .select({ count: sql<string>`count(*)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.status, "draft")))
      .then((r) => r[0]),
    db
      .select({ count: sql<string>`count(*)` })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.status, "draft")))
      .then((r) => r[0]),
    db.select({ allowNegativeStock: inventorySettings.allowNegativeStock }).from(inventorySettings).where(eq(inventorySettings.tenantId, tenantId)).limit(1),
    db
      .select({ count: sql<string>`count(*)` })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.isActive, true), sql`${items.stockQuantity} < 0`)),
    db
      .select({ count: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${salesInvoices.total} - ${salesInvoices.amountPaid}), 0)` })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.tenantId, tenantId),
          ne(salesInvoices.status, "void"),
          sql`(${salesInvoices.total} - ${salesInvoices.amountPaid}) > 0`,
          sql`coalesce(${salesInvoices.dueDate}, ${salesInvoices.invoiceDate}) < ${asOfIso}`
        )
      )
      .then((r) => r[0]),
  ]);

  const items_: NeedsAttentionItem[] = [];

  const totalDebit = round2(num(tbRow?.debit));
  const totalCredit = round2(num(tbRow?.credit));
  if (totalDebit !== totalCredit) {
    items_.push({
      id: "trial_balance",
      label: "Trial balance out of sync",
      detail: `Debits ${totalDebit.toLocaleString()} vs credits ${totalCredit.toLocaleString()}`,
      severity: "critical",
      amount: round2(Math.abs(totalDebit - totalCredit)),
    });
  }

  const draftInvoiceCount = Number(draftInvoiceRow?.count ?? 0);
  if (draftInvoiceCount > 0) {
    items_.push({ id: "draft_invoices", label: `${draftInvoiceCount} draft sales invoice${draftInvoiceCount === 1 ? "" : "s"}`, detail: "Not posted to ledger yet", severity: "action", count: draftInvoiceCount });
  }

  const draftBillCount = Number(draftBillRow?.count ?? 0);
  if (draftBillCount > 0) {
    items_.push({ id: "draft_bills", label: `${draftBillCount} draft purchase bill${draftBillCount === 1 ? "" : "s"}`, detail: "Not posted to ledger yet", severity: "action", count: draftBillCount });
  }

  const negativeStockCount = Number(negativeStockRows[0]?.count ?? 0);
  if (!invSettings?.allowNegativeStock && negativeStockCount > 0) {
    items_.push({ id: "negative_stock", label: `${negativeStockCount} item${negativeStockCount === 1 ? "" : "s"} with negative stock`, detail: "Stock on hand below zero", severity: "critical", count: negativeStockCount });
  }

  const overdueCount = Number(overdueRow?.count ?? 0);
  const overdueAmount = round2(num(overdueRow?.amount));
  if (overdueCount > 0) {
    items_.push({
      id: "overdue_receivables",
      label: `${overdueCount} overdue receivable${overdueCount === 1 ? "" : "s"}`,
      detail: "Past due date, unpaid",
      severity: "action",
      count: overdueCount,
      amount: overdueAmount,
    });
  }

  return items_;
}

// ------------------------------------------------------------ AR ageing

export type AgeingBucket = { label: string; amount: number };

/**
 * Cheap bucket-only version of receivable-ageing.ts's full report — sums invoice
 * outstanding balances into buckets without the per-customer ledger tie-out
 * (getPartyLines/buildStatement) that report does, which isn't needed for a summary widget.
 */
export async function receivableAgeingSummary(tenantId: string, asOfIso: string): Promise<{ buckets: AgeingBucket[]; total: number }> {
  const rows = await db
    .select({ total: salesInvoices.total, amountPaid: salesInvoices.amountPaid, dueDate: salesInvoices.dueDate, invoiceDate: salesInvoices.invoiceDate })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.tenantId, tenantId), ne(salesInvoices.status, "void")));

  let current = 0;
  let b1to30 = 0;
  let b31to60 = 0;
  let b61to90 = 0;
  let b90plus = 0;

  for (const r of rows) {
    const outstanding = round2(num(r.total) - num(r.amountPaid));
    if (outstanding <= 0) continue;
    const due = r.dueDate ?? r.invoiceDate;
    if (due >= asOfIso) {
      current += outstanding;
      continue;
    }
    const daysOverdue = daysBetweenIso(due, asOfIso);
    if (daysOverdue <= 30) b1to30 += outstanding;
    else if (daysOverdue <= 60) b31to60 += outstanding;
    else if (daysOverdue <= 90) b61to90 += outstanding;
    else b90plus += outstanding;
  }

  const buckets: AgeingBucket[] = [
    { label: "0–30 days", amount: round2(current + b1to30) },
    { label: "31–60 days", amount: round2(b31to60) },
    { label: "61–90 days", amount: round2(b61to90) },
    { label: "90+ days", amount: round2(b90plus) },
  ];

  return { buckets, total: round2(buckets.reduce((s, b) => s + b.amount, 0)) };
}

// --------------------------------------------------------- Compliance

export async function complianceSummary(tenantId: string, todayIso: string) {
  const rows = await db.select({ status: complianceObligations.status, dueDate: complianceObligations.dueDate }).from(complianceObligations).where(eq(complianceObligations.tenantId, tenantId));
  return summarizeCompliance(rows, todayIso);
}

export type ComplianceDeadlineRow = { id: string; name: string; dueDate: string; status: EffectiveStatus };

export async function upcomingComplianceDeadlines(tenantId: string, todayIso: string, limit = 6): Promise<ComplianceDeadlineRow[]> {
  const rows = await db
    .select({ id: complianceObligations.id, name: complianceObligations.name, dueDate: complianceObligations.dueDate, status: complianceObligations.status })
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), notInArray(complianceObligations.status, ["filed", "paid", "not_applicable"])))
    .orderBy(complianceObligations.dueDate)
    .limit(limit);

  return rows.map((r) => ({ id: r.id, name: r.name, dueDate: r.dueDate, status: effectiveStatus({ status: r.status, dueDate: r.dueDate }, todayIso) }));
}

// ------------------------------------------------------- One-call snapshot

export type DashboardSnapshot = {
  kpis: DashboardKpis;
  cashAndBank: Awaited<ReturnType<typeof cashAndBankBreakdown>>;
  trend: MonthlyTrendPoint[];
  expenseBreakdown: Awaited<ReturnType<typeof expenseBreakdown>>;
  needsAttention: NeedsAttentionItem[];
  receivableAgeing: Awaited<ReturnType<typeof receivableAgeingSummary>>;
  complianceSummary: Awaited<ReturnType<typeof complianceSummary>>;
  complianceDeadlines: ComplianceDeadlineRow[];
};

/** Everything the Dashboard page needs, in one Promise.all — the whole point of this module. */
export async function getDashboardSnapshot(tenantId: string, range: { from: string; to: string }, asOfIso: string, todayIso: string): Promise<DashboardSnapshot> {
  const [kpis, cashAndBank, trend, expenseBreakdownResult, needsAttentionResult, receivableAgeing, complianceSummaryResult, complianceDeadlines] = await Promise.all([
    dashboardKpis(tenantId, range),
    cashAndBankBreakdown(tenantId, asOfIso),
    revenueExpenseTrend(tenantId, 7, asOfIso),
    expenseBreakdown(tenantId, range),
    needsAttention(tenantId, asOfIso),
    receivableAgeingSummary(tenantId, asOfIso),
    complianceSummary(tenantId, todayIso),
    upcomingComplianceDeadlines(tenantId, todayIso),
  ]);

  return {
    kpis,
    cashAndBank,
    trend,
    expenseBreakdown: expenseBreakdownResult,
    needsAttention: needsAttentionResult,
    receivableAgeing,
    complianceSummary: complianceSummaryResult,
    complianceDeadlines,
  };
}
