import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { expenses, vendors, accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getExpenseTaxDefaults } from "./actions";
import { ExpensesTable } from "./expenses-table";

export default async function ExpensesPage() {
  const session = await requireTenantSession();

  const [expenseRows, vendorList, categoryAccounts, cashBankAccounts, taxDefaults] = await Promise.all([
    db
      .select({
        id: expenses.id,
        expenseNumber: expenses.expenseNumber,
        expenseDate: expenses.expenseDate,
        vendorId: expenses.vendorId,
        payeeName: expenses.payeeName,
        description: expenses.description,
        categoryAccountId: expenses.categoryAccountId,
        subtotal: expenses.subtotal,
        vatAmount: expenses.vatAmount,
        tdsAmount: expenses.tdsAmount,
        otherTaxAmount: expenses.otherTaxAmount,
        total: expenses.total,
        amountPayable: expenses.amountPayable,
        amountPaid: expenses.amountPaid,
        status: expenses.status,
        dueDate: expenses.dueDate,
      })
      .from(expenses)
      .where(eq(expenses.tenantId, session.tenantId))
      .orderBy(desc(expenses.expenseDate)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    getExpenseCategoryAccounts(session.tenantId),
    getCashBankAccounts(session.tenantId),
    getExpenseTaxDefaults(),
  ]);

  const categoryNameById = Object.fromEntries(categoryAccounts.map((a) => [a.id, `${a.code} — ${a.name}`]));
  // Categories referenced by existing expenses might since have been
  // deactivated or reassigned — fall back to a direct lookup so the table
  // never shows a blank category for historical rows.
  const missingCategoryIds = [...new Set(expenseRows.map((e) => e.categoryAccountId))].filter((id) => !categoryNameById[id]);
  if (missingCategoryIds.length > 0) {
    const fallback = await db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, session.tenantId)));
    for (const a of fallback) {
      if (missingCategoryIds.includes(a.id)) categoryNameById[a.id] = `${a.code} — ${a.name}`;
    }
  }

  const vendorNameById = Object.fromEntries(vendorList.map((v) => [v.id, v.name]));

  const rows = expenseRows.map((e) => ({
    id: e.id,
    expenseNumber: e.expenseNumber,
    expenseDate: e.expenseDate,
    payee: e.vendorId ? vendorNameById[e.vendorId] ?? "—" : e.payeeName ?? "—",
    vendorId: e.vendorId,
    category: categoryNameById[e.categoryAccountId] ?? "—",
    categoryAccountId: e.categoryAccountId,
    description: e.description ?? "",
    subtotal: Number(e.subtotal),
    tax: Number(e.vatAmount) + Number(e.tdsAmount) + Number(e.otherTaxAmount),
    total: Number(e.total),
    amountPayable: Number(e.amountPayable),
    amountPaid: Number(e.amountPaid),
    status: e.status,
    dueDate: e.dueDate,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>

      <ExpensesTable
        expenses={rows}
        vendors={vendorList}
        categoryAccounts={categoryAccounts}
        cashBankAccounts={cashBankAccounts}
        vatRate={taxDefaults.vatRate}
        tdsRate={taxDefaults.tdsRate}
      />
    </div>
  );
}
