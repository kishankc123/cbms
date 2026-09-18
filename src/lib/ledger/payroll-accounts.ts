import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { findControlAccount } from "./control-accounts";

// The shared expense account all payroll runs debit — a top-level account
// under the "Variable expenses" sub-category, per the tenant's chart layout.
export async function getOrCreateSalaryExpenseAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["5200"], "Salaries");
  if (existing) {
    if (existing.subCategory !== "Variable expenses") {
      const [updated] = await db
        .update(accounts)
        .set({ subCategory: "Variable expenses" })
        .where(eq(accounts.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "5200", name: "Salaries", category: "expense", subCategory: "Variable expenses" })
    .returning();
  return created;
}

// The liability group every employee's payable sub-account nests under —
// a top-level account under "Current liabilities".
export async function getOrCreateSalaryPayableGroup(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["2300"], "Salary Payable");
  if (existing) return existing;

  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "2300", name: "Salary Payable", category: "liability", subCategory: "Current liabilities" })
    .returning();
  return created;
}

// A liability account for payroll deductions withheld from employees (tax,
// etc.) — only ever created if a payroll run actually has deductions.
export async function getOrCreatePayrollDeductionsAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["2310"], "Payroll Deductions Payable");
  if (existing) return existing;

  const [created] = await db
    .insert(accounts)
    .values({
      tenantId,
      code: "2310",
      name: "Payroll Deductions Payable",
      category: "liability",
      subCategory: "Current liabilities",
    })
    .returning();
  return created;
}

// Creates the per-employee liability sub-account nested under Salary
// Payable — mirrors Chart of Accounts > Sub-group's own code/inheritance
// scheme (parent code + sequence, category/subCategory copied down). Named
// after the employee only, matching how Chart of Accounts > Sub-group names
// its own rows (just a name, no extra detail baked in).
export async function createEmployeePayableAccount(tenantId: string, employeeName: string) {
  const group = await getOrCreateSalaryPayableGroup(tenantId);

  const siblings = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, group.id)));

  const code = `${group.code}.${String(siblings.length + 1).padStart(2, "0")}`;
  const [created] = await db
    .insert(accounts)
    .values({
      tenantId,
      code,
      name: employeeName,
      category: group.category,
      subCategory: group.subCategory,
      parentAccountId: group.id,
    })
    .returning();
  return created;
}
