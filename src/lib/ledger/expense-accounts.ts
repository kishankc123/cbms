import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, ne, notLike, notExists } from "drizzle-orm";
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

// Accounts eligible as an expense's "category": Fixed/Variable expense accounts only, and only the LOWEST level —
// a category that has sub-categories can't be chosen itself, only its sub-categories can. Cost of Goods Sold
// (Purchases' territory) is excluded by sub-category, and so are the Salaries account the Payroll module owns
// (code 5200) and everything under it.
export async function getExpenseCategoryAccounts(tenantId: string) {
  const child = alias(accounts, "child");
  const parent = alias(accounts, "parent");
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory, parentCode: parent.code, parentName: parent.name })
    .from(accounts)
    .leftJoin(parent, eq(parent.id, accounts.parentAccountId))
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(accounts.isActive, true),
        eq(accounts.category, "expense"),
        inArray(accounts.subCategory, ["Fixed expenses", "Variable expenses"]),
        ne(accounts.code, "5200"),
        notLike(accounts.code, "5200.%"),
        notExists(db.select({ one: child.id }).from(child).where(and(eq(child.parentAccountId, accounts.id), eq(child.isActive, true))))
      )
    )
    .orderBy(accounts.code);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, subCategory: r.subCategory, group: r.parentCode ? `${r.parentCode} — ${r.parentName}` : null }));
}
