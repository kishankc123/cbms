import { and, asc, desc, eq, gte, inArray, like, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountRoles,
  complianceObligations,
  customers,
  expenses,
  items,
  journalEntries,
  journalLines,
  payrollLines,
  payrollRuns,
  planningSettings,
  purchaseBills,
  recurringExpenseInstances,
  recurringExpenses,
  salesInvoices,
  vendors,
} from "@/db/schema";
import { getAccountByRole, taxPayableRole } from "@/lib/compliance/tax-accounts";
import { salaryPayable } from "@/lib/payroll/salary-payable";
import { pendingCheques, type PendingCheque } from "@/lib/cheques/pending";
import { cashAccountRows, cashBalanceAsOf } from "./cash-flow";
import {
  FALLBACK_COLLECTION_DAYS,
  OVERDUE_DAYS,
  addDays,
  buildForecast,
  collectionDate,
  customerHabits,
  fixedMonthly,
  paymentDate,
  payrollEvents,
  reserveOf,
  usualDaysToPay,
  workingCapitalOf,
  type Forecast,
  type ForecastEvent,
  type SettledSummary,
  type WorkingCapital,
} from "./forecast-rules";

export * from "./forecast-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

export type PlanningSettings = { reserveMonths: number; reserveOverride: number | null; defaultCollectionDays: number | null };

export async function getPlanningSettings(tenantId: string): Promise<PlanningSettings> {
  const [row] = await db.select().from(planningSettings).where(eq(planningSettings.tenantId, tenantId)).limit(1);
  return { reserveMonths: row?.reserveMonths ?? 3, reserveOverride: row?.reserveOverride != null ? num(row.reserveOverride) : null, defaultCollectionDays: row?.defaultCollectionDays ?? null };
}

// Open documents are the ones that are posted and still have something unpaid; drafts and voids are not money that is coming or going.
const openInvoice = (tenantId: string) => and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"]), sql`(${salesInvoices.total} - ${salesInvoices.amountPaid}) > 0`);
const openBill = (tenantId: string) => and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"]), sql`(${purchaseBills.total} - ${purchaseBills.amountPaid}) > 0`);
const openExpense = (tenantId: string) => and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void"), sql`(${expenses.amountPayable} - ${expenses.amountPaid}) > 0`);

async function creditBalance(tenantId: string, accountIds: string[]): Promise<number> {
  if (accountIds.length === 0) return 0;
  const [r] = await db
    .select({ c: sql<string>`coalesce(sum(${journalLines.creditAmount}), 0)`, d: sql<string>`coalesce(sum(${journalLines.debitAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)));
  return round2(num(r?.c) - num(r?.d));
}

/**
 * How customers have paid, from invoices settled in the last 6 months: one small row of sums per customer, worked out in the database,
 * so a long history never travels to the server. Paid on the day they were raised is a cash sale, not a habit of paying late, so those are left out.
 */
export async function settledSummaries(tenantId: string, today: string): Promise<SettledSummary[]> {
  const res = (await db.execute(sql`
    select customer_id, count(*)::int as invoices, sum(total) as amount,
           sum(total * (paid - invoice_date)) as days_from_doc,
           sum(case when due_date is not null then total * (paid - due_date) else 0 end) as lag_from_due,
           sum(case when due_date is null then total else 0 end) as amount_no_due,
           sum(case when due_date is null then total * (paid - invoice_date) else 0 end) as days_from_doc_no_due
    from (
      select si.id, si.customer_id, si.total, si.invoice_date, si.due_date, max(p.payment_date) as paid
      from sales_invoices si
      join payment_allocations pa on pa.target_type = 'sales_invoice' and pa.target_id = si.id
      join payments_ledger p on p.id = pa.payment_id and p.status = 'posted'
      where si.tenant_id = ${tenantId}::uuid and si.status = 'paid' and p.payment_date >= ${addDays(today, -183)}::date
      group by si.id, si.customer_id, si.total, si.invoice_date, si.due_date
      having max(p.payment_date) > si.invoice_date
    ) settled
    group by customer_id`)) as unknown as Record<string, string>[] | { rows: Record<string, string>[] };
  const rows = Array.isArray(res) ? res : res.rows;
  return rows.map((r) => ({ customerId: r.customer_id, invoices: Number(r.invoices), amount: num(r.amount), daysFromDoc: num(r.days_from_doc), lagFromDue: num(r.lag_from_due), amountNoDue: num(r.amount_no_due), daysFromDocNoDue: num(r.days_from_doc_no_due) }));
}

export type ForecastResult = {
  forecast: Forecast;
  workingCapital: WorkingCapital;
  /** Working capital at the end of the horizon, before any new sales or purchases: today's, less pay and recurring costs still to come. */
  projectedWorkingCapital: number;
  reserve: { amount: number; how: string; fixedMonthly: number };
  assumptions: {
    defaultDays: number;
    defaultDaysSource: "setting" | "learned" | "fallback";
    customersWithHabit: number;
    unpricedTaxes: number;
    overdueDays: number;
  };
  settings: PlanningSettings;
  /** Cheques written and not yet cleared, and the ones the forecast expects the account cannot cover on the day. */
  cheques: { count: number; amount: number; atRisk: ChequeRisk[] };
};

export type ChequeRisk = { id: string; chequeNumber: string; payee: string; amount: number; date: string; balance: number };

export type ForecastOptions = {
  /** A cheque that is still being written, tried as if it were already in the register (not saved anywhere). */
  extraCheques?: PendingCheque[];
};

/**
 * One forecast for the whole page: a handful of queries (cash, open invoices, bills, expenses, scheduled recurring costs,
 * payroll, taxes, a 6-month payment history), all shared by every number shown, so the figures can never disagree.
 */
export async function loadForecast(tenantId: string, today: string, horizonDays: number, options: ForecastOptions = {}): Promise<ForecastResult> {
  const horizonEnd = addDays(today, horizonDays);
  const settings = await getPlanningSettings(tenantId);

  const [cashAccounts, history, savedCheques] = await Promise.all([cashAccountRows(tenantId), settledSummaries(tenantId, today), pendingCheques(tenantId)]);
  const cheques = [...savedCheques, ...(options.extraCheques ?? [])];
  // A bill or expense that a cheque already covers is not forecast on its own due date: the cheque is the cash going out, on its date.
  const coveredVendors = [...new Set(cheques.filter((c) => c.payeeKind === "supplier" && c.vendorId).map((c) => c.vendorId!))];
  const coveredExpenses = [...new Set(cheques.filter((c) => c.payeeKind === "expense" && c.expenseId).map((c) => c.expenseId!))];
  const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const billNotCovered = coveredVendors.length ? sql`(${purchaseBills.vendorId} is null or ${purchaseBills.vendorId} not in (${idList(coveredVendors)}))` : sql`true`;
  const expenseNotCovered = coveredExpenses.length ? sql`${expenses.id} not in (${idList(coveredExpenses)})` : sql`true`;
  const openingCash = await cashBalanceAsOf(tenantId, cashAccounts.map((a) => a.id), today);

  const learned = usualDaysToPay(history);
  const defaultDays = settings.defaultCollectionDays ?? learned ?? FALLBACK_COLLECTION_DAYS;
  const defaultDaysSource = settings.defaultCollectionDays !== null ? "setting" : learned !== null ? "learned" : "fallback";
  const habits = customerHabits(history, defaultDays);

  // Only documents that can land inside the horizon are fetched one by one. Everything already overdue moves on the same assumed day,
  // so it arrives as a total, and every open document is totalled once for working capital.
  const lags = [...habits.values()].map((h) => h.lagDays);
  const maxLate = Math.min(Math.max(0, ...lags), 365);
  const maxEarly = Math.min(Math.max(0, ...lags.map((l) => -l)), 365);
  const nearFrom = addDays(today, -maxLate);
  const nearTo = addDays(horizonEnd, maxEarly);
  const invOutstanding = sql<string>`(${salesInvoices.total} - ${salesInvoices.amountPaid})`;
  const invAgreed = sql<string>`coalesce(${salesInvoices.dueDate}, ${salesInvoices.invoiceDate} + ${defaultDays}::int)`;
  const billOutstanding = sql<string>`(${purchaseBills.total} - ${purchaseBills.amountPaid})`;
  const billAgreed = sql<string>`coalesce(${purchaseBills.dueDate}, ${purchaseBills.billDate})`;
  const expOutstanding = sql<string>`(${expenses.amountPayable} - ${expenses.amountPaid})`;
  const expAgreed = sql<string>`coalesce(${expenses.dueDate}, ${expenses.expenseDate})`;

  const [invoiceAgg, billAgg, expenseAgg, invoiceRows, billRows, expenseRows, coveredBills, coveredExpenseRows, instanceRows, salaryRows, lastRun, taxRows, recurringDefs, stockRow, taxAccounts] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${invOutstanding}), 0)`, oldAmount: sql<string>`coalesce(sum(${invOutstanding}) filter (where ${invAgreed} < ${nearFrom}::date), 0)`, oldCount: sql<string>`count(*) filter (where ${invAgreed} < ${nearFrom}::date)` })
      .from(salesInvoices)
      .where(openInvoice(tenantId)),
    db
      .select({ total: sql<string>`coalesce(sum(${billOutstanding}), 0)`, oldAmount: sql<string>`coalesce(sum(${billOutstanding}) filter (where ${billAgreed} < ${today}::date and ${billNotCovered}), 0)`, oldCount: sql<string>`count(*) filter (where ${billAgreed} < ${today}::date and ${billNotCovered})` })
      .from(purchaseBills)
      .where(openBill(tenantId)),
    db
      .select({ total: sql<string>`coalesce(sum(${expOutstanding}), 0)`, oldAmount: sql<string>`coalesce(sum(${expOutstanding}) filter (where ${expAgreed} < ${today}::date and ${expenseNotCovered}), 0)`, oldCount: sql<string>`count(*) filter (where ${expAgreed} < ${today}::date and ${expenseNotCovered})` })
      .from(expenses)
      .where(openExpense(tenantId)),
    db
      .select({ id: salesInvoices.id, customerId: salesInvoices.customerId, customer: customers.name, docDate: salesInvoices.invoiceDate, dueDate: salesInvoices.dueDate, outstanding: invOutstanding })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(openInvoice(tenantId), gte(invAgreed, nearFrom), lte(invAgreed, nearTo))),
    db
      .select({ id: purchaseBills.id, vendor: vendors.name, docDate: purchaseBills.billDate, dueDate: purchaseBills.dueDate, outstanding: billOutstanding })
      .from(purchaseBills)
      .leftJoin(vendors, eq(vendors.id, purchaseBills.vendorId))
      .where(and(openBill(tenantId), gte(billAgreed, today), lte(billAgreed, horizonEnd), billNotCovered)),
    db
      .select({ id: expenses.id, vendor: vendors.name, payee: expenses.payeeName, docDate: expenses.expenseDate, dueDate: expenses.dueDate, outstanding: expOutstanding })
      .from(expenses)
      .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
      .where(and(openExpense(tenantId), gte(expAgreed, today), lte(expAgreed, horizonEnd), expenseNotCovered)),
    coveredVendors.length
      ? db
          .select({ id: purchaseBills.id, vendorId: purchaseBills.vendorId, vendor: vendors.name, docDate: purchaseBills.billDate, dueDate: purchaseBills.dueDate, outstanding: billOutstanding })
          .from(purchaseBills)
          .leftJoin(vendors, eq(vendors.id, purchaseBills.vendorId))
          .where(and(openBill(tenantId), sql`${purchaseBills.vendorId} in (${idList(coveredVendors)})`))
          .orderBy(asc(purchaseBills.billDate), asc(purchaseBills.billNumber))
      : Promise.resolve([]),
    coveredExpenses.length
      ? db
          .select({ id: expenses.id, vendor: vendors.name, payee: expenses.payeeName, docDate: expenses.expenseDate, dueDate: expenses.dueDate, outstanding: expOutstanding })
          .from(expenses)
          .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
          .where(and(openExpense(tenantId), sql`${expenses.id} in (${idList(coveredExpenses)})`))
      : Promise.resolve([]),
    db
      .select({ id: recurringExpenseInstances.id, name: recurringExpenses.expenseName, date: sql<string>`coalesce(${recurringExpenseInstances.dueDate}, ${recurringExpenseInstances.expenseDate})`, amount: recurringExpenseInstances.expectedAmount })
      .from(recurringExpenseInstances)
      .innerJoin(recurringExpenses, eq(recurringExpenses.id, recurringExpenseInstances.recurringExpenseId))
      .where(and(eq(recurringExpenseInstances.tenantId, tenantId), sql`${recurringExpenseInstances.expenseId} is null`, ne(recurringExpenses.status, "stopped"), gte(sql`coalesce(${recurringExpenseInstances.dueDate}, ${recurringExpenseInstances.expenseDate})`, today), lte(sql`coalesce(${recurringExpenseInstances.dueDate}, ${recurringExpenseInstances.expenseDate})`, horizonEnd))),
    salaryPayable(tenantId, new Date(today + "T00:00:00Z")),
    db
      .select({ id: payrollRuns.id, periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized")))
      .orderBy(desc(payrollRuns.periodEnd))
      .limit(1),
    db
      .select({ id: complianceObligations.id, name: complianceObligations.name, taxTypeKey: complianceObligations.taxTypeKey, due: sql<string>`coalesce(${complianceObligations.paymentDueDate}, ${complianceObligations.dueDate})`, status: complianceObligations.status, amountDue: complianceObligations.amountDue })
      .from(complianceObligations)
      .where(and(eq(complianceObligations.tenantId, tenantId), inArray(complianceObligations.status, ["pending", "in_progress", "partially_paid"]), eq(complianceObligations.filedBeforeSystem, false), lte(sql`coalesce(${complianceObligations.paymentDueDate}, ${complianceObligations.dueDate})`, horizonEnd), sql`${complianceObligations.taxTypeKey} is not null`)),
    db.select({ accountId: recurringExpenses.expenseAccountId, amount: recurringExpenses.amount, months: recurringExpenses.intervalMonths }).from(recurringExpenses).where(and(eq(recurringExpenses.tenantId, tenantId), eq(recurringExpenses.status, "active"))),
    db.select({ v: sql<string>`coalesce(sum(${items.stockValue}), 0)` }).from(items).where(and(eq(items.tenantId, tenantId), eq(items.inventoryTracking, true))),
    db.select({ roleKey: accountRoles.roleKey, accountId: accountRoles.accountId }).from(accountRoles).where(and(eq(accountRoles.tenantId, tenantId), like(accountRoles.roleKey, "tax_payable:%"))),
  ]);

  const events: ForecastEvent[] = [];

  const overdueEvent = (id: string, category: ForecastEvent["category"], side: ForecastEvent["side"], party: string, agg: { oldAmount: string; oldCount: string }) => {
    const amount = round2(num(agg.oldAmount));
    if (amount > 0) events.push({ id, category, side, date: addDays(today, OVERDUE_DAYS), amount, party, basis: "overdue", certainty: "expected", count: Number(agg.oldCount) });
  };
  overdueEvent("inv-overdue", "collections", "in", "Overdue invoices", invoiceAgg[0]);
  overdueEvent("bill-overdue", "supplier_payments", "out", "Overdue bills", billAgg[0]);
  overdueEvent("exp-overdue", "expenses", "out", "Overdue expenses", expenseAgg[0]);
  for (const r of invoiceRows) {
    const { date, basis } = collectionDate({ dueDate: r.dueDate, docDate: r.docDate, today, habit: habits.get(r.customerId) ?? null, defaultDays });
    events.push({ id: `inv-${r.id}`, category: "collections", side: "in", date, amount: round2(num(r.outstanding)), party: r.customer, basis, certainty: basis === "due_date" ? "confirmed" : "expected" });
  }
  for (const r of billRows) {
    const { date, basis } = paymentDate({ dueDate: r.dueDate, docDate: r.docDate, today });
    events.push({ id: `bill-${r.id}`, category: "supplier_payments", side: "out", date, amount: round2(num(r.outstanding)), party: r.vendor ?? "No supplier", basis, certainty: basis === "due_date" ? "confirmed" : "expected" });
  }
  for (const r of expenseRows) {
    const { date, basis } = paymentDate({ dueDate: r.dueDate, docDate: r.docDate, today });
    events.push({ id: `exp-${r.id}`, category: "expenses", side: "out", date, amount: round2(num(r.outstanding)), party: r.vendor ?? r.payee ?? "Expense", basis, certainty: basis === "due_date" ? "confirmed" : "expected" });
  }
  // What a cheque does not cover of a bill or expense is still forecast as before; what it covers is replaced by the cheque itself.
  const chequeLeft = new Map<string, number>();
  for (const c of cheques) if (c.payeeKind === "supplier" && c.vendorId) chequeLeft.set(c.vendorId, round2((chequeLeft.get(c.vendorId) ?? 0) + c.amount));
  for (const r of coveredBills) {
    const left = chequeLeft.get(r.vendorId ?? "") ?? 0;
    const take = Math.min(left, round2(num(r.outstanding)));
    chequeLeft.set(r.vendorId ?? "", round2(left - take));
    const remaining = round2(num(r.outstanding) - take);
    if (remaining <= 0.005) continue;
    const { date, basis } = paymentDate({ dueDate: r.dueDate, docDate: r.docDate, today });
    events.push({ id: `bill-${r.id}`, category: "supplier_payments", side: "out", date, amount: remaining, party: r.vendor ?? "No supplier", basis, certainty: basis === "due_date" ? "confirmed" : "expected" });
  }
  const expenseCheque = new Map<string, number>();
  for (const c of cheques) if (c.payeeKind === "expense" && c.expenseId) expenseCheque.set(c.expenseId, round2((expenseCheque.get(c.expenseId) ?? 0) + c.amount));
  for (const r of coveredExpenseRows) {
    const remaining = round2(num(r.outstanding) - (expenseCheque.get(r.id) ?? 0));
    if (remaining <= 0.005) continue;
    const { date, basis } = paymentDate({ dueDate: r.dueDate, docDate: r.docDate, today });
    events.push({ id: `exp-${r.id}`, category: "expenses", side: "out", date, amount: remaining, party: r.vendor ?? r.payee ?? "Expense", basis, certainty: basis === "due_date" ? "confirmed" : "expected" });
  }
  // The cheques themselves go out on the date written on them (a cheque already past its date is presented now).
  for (const c of cheques) {
    events.push({ id: `chq-${c.id}`, category: "cheques", side: "out", date: c.chequeDate < today ? today : c.chequeDate, amount: round2(c.amount), party: `${c.payeeName} (cheque ${c.chequeNumber})`, basis: "due_date", certainty: "confirmed" });
  }
  for (const r of instanceRows) {
    events.push({ id: `rec-${r.id}`, category: "recurring", side: "out", date: r.date, amount: round2(num(r.amount)), party: r.name, basis: "scheduled", certainty: "expected" });
  }

  // Salaries already owed (finalised, unpaid) are assumed paid soon; later months repeat the last finalised month's pay.
  const salaryOwed = round2(salaryRows.reduce((s, r) => s + r.balance, 0));
  if (salaryOwed > 0) events.push({ id: "salary-owed", category: "payroll", side: "out", date: addDays(today, OVERDUE_DAYS), amount: salaryOwed, party: "Salaries owed", basis: "assumed", certainty: "expected" });
  let lastPay: { periodStart: string; periodEnd: string; total: number } | null = null;
  if (lastRun[0]) {
    const [t] = await db.select({ v: sql<string>`coalesce(sum(${payrollLines.netPay}), 0)` }).from(payrollLines).where(eq(payrollLines.payrollRunId, lastRun[0].id));
    lastPay = { periodStart: lastRun[0].periodStart, periodEnd: lastRun[0].periodEnd, total: num(t?.v) };
  }
  const futurePayroll = payrollEvents(lastPay, today, horizonEnd);
  events.push(...futurePayroll);

  // Taxes: the amount entered on the obligation, else what the books say is owed to that tax, put against its earliest deadline only.
  const roleAccount = new Map(taxAccounts.map((a) => [a.roleKey, a.accountId]));
  const owedByTax = new Map<string, number>();
  for (const key of new Set(taxRows.map((t) => t.taxTypeKey!))) {
    const acct = roleAccount.get(taxPayableRole(key)) ?? (await getAccountByRole(tenantId, taxPayableRole(key)))?.id;
    owedByTax.set(key, acct ? await creditBalance(tenantId, [acct]) : 0);
  }
  const used = new Set<string>();
  let unpricedTaxes = 0;
  for (const t of [...taxRows].sort((a, b) => (a.due < b.due ? -1 : 1))) {
    const key = t.taxTypeKey!;
    const entered = t.status !== "partially_paid" && t.amountDue !== null ? num(t.amountDue) : 0;
    let amount = entered;
    let certainty: ForecastEvent["certainty"] = "confirmed";
    if (amount <= 0 && !used.has(key) && (owedByTax.get(key) ?? 0) > 0) {
      amount = owedByTax.get(key)!;
      certainty = "estimated";
      used.add(key);
    }
    if (amount <= 0) {
      unpricedTaxes++;
      continue;
    }
    const overdue = t.due < today;
    events.push({ id: `tax-${t.id}`, category: "taxes", side: "out", date: overdue ? addDays(today, OVERDUE_DAYS) : t.due, amount: round2(amount), party: t.name, basis: overdue ? "overdue" : "due_date", certainty });
  }

  // The reserve: months of fixed expenses (payroll and the categories used by recurring expenses), from the last 3 months' actuals.
  const since = addDays(today, -90);
  const recurringAccounts = [...new Set(recurringDefs.map((d) => d.accountId))];
  const [spentRow, payrollRow] = await Promise.all([
    recurringAccounts.length ? db.select({ v: sql<string>`coalesce(sum(${expenses.total}), 0)` }).from(expenses).where(and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void"), gte(expenses.expenseDate, since), inArray(expenses.categoryAccountId, recurringAccounts))) : Promise.resolve([{ v: "0" }]),
    db
      .select({ v: sql<string>`coalesce(sum(${payrollLines.grossPay}), 0)`, runs: sql<string>`count(distinct ${payrollRuns.id})` })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"), gte(payrollRuns.periodEnd, since))),
  ]);
  const definitionsPerMonth = round2(recurringDefs.reduce((s, d) => s + num(d.amount) / Math.max(d.months, 1), 0)) + (lastPay?.total ?? 0);
  // Payroll is averaged over the months actually run (one run is one month), the recurring spending over the 3 months.
  const payrollRuns90 = Number(payrollRow[0]?.runs ?? 0);
  const payrollMonthly = payrollRuns90 > 0 ? num(payrollRow[0]?.v) / payrollRuns90 : 0;
  const fixed = fixedMonthly(num(spentRow[0]?.v) / 3 + payrollMonthly, definitionsPerMonth);
  const reserve = reserveOf({ months: settings.reserveMonths, override: settings.reserveOverride }, fixed);

  const forecast = buildForecast({ today, horizonDays, openingCash, reserve: reserve.amount, events });

  // Working capital: what the business holds to run on, less what it owes in the short term.
  const receivables = round2(num(invoiceAgg[0]?.total));
  const payables = round2(num(billAgg[0]?.total) + num(expenseAgg[0]?.total));
  const taxPayable = await creditBalance(tenantId, taxAccounts.map((a) => a.accountId));
  const workingCapital = workingCapitalOf({ cash: round2(openingCash), receivables, stock: round2(num(stockRow[0]?.v)), payables, salaryPayable: salaryOwed, taxPayable });
  // Collecting a receivable or paying a payable only moves value between the two sides. What lowers it is spending that is not owed yet.
  const notYetOwed = futurePayroll.reduce((sum, e) => sum + e.amount, 0) + instanceRows.reduce((sum, r) => sum + num(r.amount), 0);
  const projectedWorkingCapital = round2(workingCapital.workingCapital - notYetOwed);

  // A cheque is at risk when the forecast has the account below zero on the day it can be presented.
  const balanceOn = new Map(forecast.days.map((d) => [d.date, d.balance]));
  const atRisk: ChequeRisk[] = [];
  for (const c of savedCheques) {
    const date = c.chequeDate < today ? today : c.chequeDate;
    const balance = balanceOn.get(date);
    if (balance !== undefined && balance < 0) atRisk.push({ id: c.id, chequeNumber: c.chequeNumber, payee: c.payeeName, amount: c.amount, date, balance });
  }

  return {
    cheques: { count: savedCheques.length, amount: round2(savedCheques.reduce((s, c) => s + c.amount, 0)), atRisk },
    forecast,
    workingCapital,
    projectedWorkingCapital,
    reserve: { ...reserve, fixedMonthly: fixed },
    assumptions: { defaultDays, defaultDaysSource, customersWithHabit: habits.size, unpricedTaxes, overdueDays: OVERDUE_DAYS },
    settings,
  };
}
