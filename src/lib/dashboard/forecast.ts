import { and, desc, eq, gte, inArray, like, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountRoles,
  complianceObligations,
  customers,
  expenses,
  items,
  journalEntries,
  journalLines,
  paymentAllocations,
  payments,
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
  type SettledInvoice,
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

/** Invoices settled in the last 6 months, with the day the last payment against each was made. Paid on the day they were raised is a cash sale, not a habit of paying late, so those are left out. */
export async function settledInvoices(tenantId: string, today: string): Promise<SettledInvoice[]> {
  const rows = await db
    .select({ invoiceId: salesInvoices.id, customerId: salesInvoices.customerId, total: salesInvoices.total, docDate: salesInvoices.invoiceDate, dueDate: salesInvoices.dueDate, paidDate: sql<string>`max(${payments.paymentDate})` })
    .from(salesInvoices)
    .innerJoin(paymentAllocations, and(eq(paymentAllocations.targetType, "sales_invoice"), eq(paymentAllocations.targetId, salesInvoices.id)))
    .innerJoin(payments, and(eq(payments.id, paymentAllocations.paymentId), eq(payments.status, "posted")))
    .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.status, "paid"), gte(payments.paymentDate, addDays(today, -183))))
    .groupBy(salesInvoices.id, salesInvoices.customerId, salesInvoices.total, salesInvoices.invoiceDate, salesInvoices.dueDate)
    .having(sql`max(${payments.paymentDate}) > ${salesInvoices.invoiceDate}`);
  return rows.map((r) => ({ customerId: r.customerId, invoiceId: r.invoiceId, amount: num(r.total), docDate: r.docDate, dueDate: r.dueDate, paidDate: r.paidDate }));
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
};

/**
 * One forecast for the whole page: a handful of queries (cash, open invoices, bills, expenses, scheduled recurring costs,
 * payroll, taxes, a 6-month payment history), all shared by every number shown, so the figures can never disagree.
 */
export async function loadForecast(tenantId: string, today: string, horizonDays: number): Promise<ForecastResult> {
  const horizonEnd = addDays(today, horizonDays);
  const settings = await getPlanningSettings(tenantId);

  const [cashAccounts, history] = await Promise.all([cashAccountRows(tenantId), settledInvoices(tenantId, today)]);
  const openingCash = await cashBalanceAsOf(tenantId, cashAccounts.map((a) => a.id), today);

  const learned = usualDaysToPay(history);
  const defaultDays = settings.defaultCollectionDays ?? learned ?? FALLBACK_COLLECTION_DAYS;
  const defaultDaysSource = settings.defaultCollectionDays !== null ? "setting" : learned !== null ? "learned" : "fallback";
  const habits = customerHabits(history, defaultDays);

  const [invoiceRows, billRows, expenseRows, instanceRows, salaryRows, lastRun, taxRows, recurringDefs, stockRow, taxAccounts] = await Promise.all([
    db
      .select({ id: salesInvoices.id, customerId: salesInvoices.customerId, customer: customers.name, docDate: salesInvoices.invoiceDate, dueDate: salesInvoices.dueDate, outstanding: sql<string>`(${salesInvoices.total} - ${salesInvoices.amountPaid})` })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(openInvoice(tenantId)),
    db
      .select({ id: purchaseBills.id, vendor: vendors.name, docDate: purchaseBills.billDate, dueDate: purchaseBills.dueDate, outstanding: sql<string>`(${purchaseBills.total} - ${purchaseBills.amountPaid})` })
      .from(purchaseBills)
      .leftJoin(vendors, eq(vendors.id, purchaseBills.vendorId))
      .where(openBill(tenantId)),
    db
      .select({ id: expenses.id, vendor: vendors.name, payee: expenses.payeeName, docDate: expenses.expenseDate, dueDate: expenses.dueDate, outstanding: sql<string>`(${expenses.amountPayable} - ${expenses.amountPaid})` })
      .from(expenses)
      .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
      .where(openExpense(tenantId)),
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
  const receivables = round2(invoiceRows.reduce((s, r) => s + num(r.outstanding), 0));
  const payables = round2([...billRows, ...expenseRows].reduce((s, r) => s + num(r.outstanding), 0));
  const taxPayable = await creditBalance(tenantId, taxAccounts.map((a) => a.accountId));
  const workingCapital = workingCapitalOf({ cash: round2(openingCash), receivables, stock: round2(num(stockRow[0]?.v)), payables, salaryPayable: salaryOwed, taxPayable });
  // Collecting a receivable or paying a payable only moves value between the two sides. What lowers it is spending that is not owed yet.
  const notYetOwed = futurePayroll.reduce((sum, e) => sum + e.amount, 0) + instanceRows.reduce((sum, r) => sum + num(r.amount), 0);
  const projectedWorkingCapital = round2(workingCapital.workingCapital - notYetOwed);

  return {
    forecast,
    workingCapital,
    projectedWorkingCapital,
    reserve: { ...reserve, fixedMonthly: fixed },
    assumptions: { defaultDays, defaultDaysSource, customersWithHabit: habits.size, unpricedTaxes, overdueDays: OVERDUE_DAYS },
    settings,
  };
}
