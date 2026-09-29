import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, accounts } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { listRecurringExpenses, getRecurringExpenseSummary } from "@/lib/recurring-expenses";
import { todayIso } from "@/lib/calendar";
import { BackButton } from "@/components/ui/back-button";
import { RecurringExpensesTable, type RecurringExpenseRow } from "./recurring-expenses-table";
import { RecurringEngineRunner } from "./recurring-engine-runner";

const currency = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export default async function RecurringExpensesPage() {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "view")) throw new Error("Not permitted");

  const [recurringRows, vendorList, categoryAccounts, cashBankAccounts, summary] = await Promise.all([
    listRecurringExpenses(session.tenantId),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    getExpenseCategoryAccounts(session.tenantId),
    getCashBankAccounts(session.tenantId),
    getRecurringExpenseSummary(session.tenantId, session.calendar, todayIso()),
  ]);

  const categoryLabelById = Object.fromEntries(categoryAccounts.map((a) => [a.id, `${a.code} — ${a.name}`]));
  const missingCategoryIds = [...new Set(recurringRows.map((r) => r.expenseAccountId))].filter((id) => !categoryLabelById[id]);
  if (missingCategoryIds.length > 0) {
    const fallback = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.tenantId, session.tenantId));
    for (const a of fallback) if (missingCategoryIds.includes(a.id)) categoryLabelById[a.id] = `${a.code} — ${a.name}`;
  }
  const vendorNameById = Object.fromEntries(vendorList.map((v) => [v.id, v.name]));

  const rows: RecurringExpenseRow[] = recurringRows.map((r) => ({
    id: r.id,
    expenseName: r.expenseName,
    expenseAccountLabel: categoryLabelById[r.expenseAccountId] ?? "—",
    payee: r.vendorId ? (vendorNameById[r.vendorId] ?? "—") : (r.payeeName ?? "—"),
    amount: Number(r.amount),
    frequency: r.frequency,
    priority: r.priority,
    status: r.status,
    raw: {
      id: r.id,
      expenseName: r.expenseName,
      expenseAccountId: r.expenseAccountId,
      vendorId: r.vendorId,
      payeeName: r.payeeName,
      amount: r.amount,
      frequency: r.frequency,
      intervalMonths: r.intervalMonths,
      recognitionRule: r.recognitionRule,
      recognitionDay: r.recognitionDay,
      dueRule: r.dueRule,
      dueRuleValue: r.dueRuleValue,
      startDate: r.startDate,
      endDate: r.endDate,
      priority: r.priority,
      expectedPaymentAccountId: r.expectedPaymentAccountId,
      notes: r.notes,
    },
  }));

  return (
    <div className="space-y-6">
      <RecurringEngineRunner />
      <div className="flex items-start gap-3">
        <BackButton href="/expenses" label="Back to One-off Expenses" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Recurring Expenses</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Rent, subscriptions, and other expenses that repeat on a schedule.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">Active Recurring Expenses</p>
          <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{summary.activeCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">Expected This Month</p>
          <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{currency(summary.expectedThisMonth)}</p>
        </div>
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">Expected Next 30 Days</p>
          <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{currency(summary.expectedNext30Days)}</p>
        </div>
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">Outstanding Liabilities</p>
          <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{currency(summary.outstandingLiabilities)}</p>
        </div>
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">Overdue Payments</p>
          <p className="mt-1 text-xl font-semibold text-[var(--status-critical-text)]">
            {summary.overdueCount} {summary.overdueCount === 1 ? "item" : "items"}
          </p>
          {summary.overdueCount > 0 && <p className="text-xs text-[var(--text-secondary)]">{currency(summary.overdueAmount)}</p>}
        </div>
      </div>

      <RecurringExpensesTable expenses={rows} vendors={vendorList} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} />
    </div>
  );
}
