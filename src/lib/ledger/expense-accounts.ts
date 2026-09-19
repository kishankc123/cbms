import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { findControlAccount } from "./control-accounts";

// The liability account TDS withheld from payees is credited to.
export async function getOrCreateTdsPayableAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["2320"], "TDS Payable");
  if (existing) return existing;

  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "2320", name: "TDS Payable", category: "liability", subCategory: "Current liabilities" })
    .returning();
  return created;
}

// The liability account an expense's unpaid balance sits in until settled —
// separate from Accounts Payable (which is reserved for Purchases) per the
// module's "do not duplicate Purchases" rule.
export async function getOrCreateExpensePayableAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["2340"], "Expense Payable");
  if (existing) return existing;

  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "2340", name: "Expense Payable", category: "liability", subCategory: "Current liabilities" })
    .returning();
  return created;
}

// Accounts eligible as an expense's "category" — Fixed/Variable expense
// accounts only. Excludes Cost of Goods Sold (Purchases' territory) by not
// matching that sub-category, and explicitly excludes the Salaries account
// the Payroll module owns (code 5200), which also carries a "Variable
// expenses" sub-category but must never be reused for Expenses postings.
export async function getExpenseCategoryAccounts(tenantId: string) {
  return db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory })
    .from(accounts)
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.isActive, true),
        eq(accounts.category, "expense"),
        inArray(accounts.subCategory, ["Fixed expenses", "Variable expenses"]),
        ne(accounts.code, "5200")
      )
    )
    .orderBy(accounts.code);
}
