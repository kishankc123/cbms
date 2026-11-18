import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { findControlAccount, createSubAccount } from "./control-accounts";
import { getOrCreateTdsPayableAccount } from "./expense-accounts";
import { getAccountByRole, setAccountRole } from "@/lib/compliance/tax-accounts";

// The shared expense account all payroll runs debit — a top-level account
// under the "Indirect expenses" sub-category, per the tenant's chart layout.
export async function getOrCreateSalaryExpenseAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["5200"], "Salaries");
  if (existing) {
    if (existing.subCategory !== "Indirect expenses") {
      const [updated] = await db
        .update(accounts)
        .set({ subCategory: "Indirect expenses" })
        .where(eq(accounts.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "5200", name: "Salaries", category: "expense", subCategory: "Indirect expenses" })
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

// Where salary TDS withheld from employees is credited: its own account under TDS Payable, so it stays apart from the TDS withheld on
// rent and service bills and can be deposited and reported by heading.
export const SALARY_TDS_ACCOUNT_NAME = "TDS Payable — Salary";
export async function getOrCreateSalaryTdsPayableAccount(tenantId: string) {
  const parent = await getOrCreateTdsPayableAccount(tenantId);
  const [existing] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, parent.id), eq(accounts.name, SALARY_TDS_ACCOUNT_NAME))).limit(1);
  return existing ?? (await createSubAccount(tenantId, parent, SALARY_TDS_ACCOUNT_NAME));
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
// Payable. Named after the employee only, matching how Chart of Accounts >
// Sub-group names its own rows (just a name, no extra detail baked in).
export async function createEmployeePayableAccount(tenantId: string, employeeName: string) {
  const group = await getOrCreateSalaryPayableGroup(tenantId);
  return createSubAccount(tenantId, group, employeeName);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Salaries is a group with three parts, so the profit and loss shows what pay is made of: Basic salary, Performance incentives (a group of its
// own, with one account per incentive heading) and Allowances. A payroll run posts its gross pay across them. Each is found by its account role
// (so it can be renamed), made on first use, and locked as a system account. Pay posted before this existed stays on Salaries itself.
// ---------------------------------------------------------------------------------------------------------------------------------------

const SALARY_PARTS = [
  { role: "salary_basic", name: "Basic salary" },
  { role: "salary_incentives", name: "Performance incentives" },
  { role: "salary_allowances", name: "Allowances" },
] as const;
type SalaryPart = (typeof SALARY_PARTS)[number]["role"];

/** The Basic salary, Performance incentives and Allowances accounts under Salaries, made in that order when missing. */
export async function getSalaryPartAccounts(tenantId: string): Promise<Record<"basic" | "incentives" | "allowances", typeof accounts.$inferSelect>> {
  const salaries = await getOrCreateSalaryExpenseAccount(tenantId);
  const found = {} as Record<SalaryPart, typeof accounts.$inferSelect>;
  for (const part of SALARY_PARTS) {
    let account = await getAccountByRole(tenantId, part.role);
    if (!account) {
      [account] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, salaries.id), eq(accounts.name, part.name))).limit(1);
      account ??= await createSubAccount(tenantId, salaries, part.name);
      await setAccountRole(tenantId, part.role, account.id);
    }
    found[part.role] = account;
  }
  return { basic: found.salary_basic, incentives: found.salary_incentives, allowances: found.salary_allowances };
}

const headingRole = (headingId: string) => `incentive_heading:${headingId}`;

/** The expense account of one incentive heading, under Salaries > Performance incentives. Made the first time it is needed; renamed with the heading. */
export async function getOrCreateIncentiveHeadingAccount(tenantId: string, headingId: string, headingName: string) {
  const mapped = await getAccountByRole(tenantId, headingRole(headingId));
  if (mapped) return mapped;
  const { incentives } = await getSalaryPartAccounts(tenantId);
  const account = await createSubAccount(tenantId, incentives, headingName);
  await setAccountRole(tenantId, headingRole(headingId), account.id);
  return account;
}

export async function renameIncentiveHeadingAccount(tenantId: string, headingId: string, headingName: string) {
  const account = await getAccountByRole(tenantId, headingRole(headingId));
  if (account && account.name !== headingName) await db.update(accounts).set({ name: headingName }).where(and(eq(accounts.id, account.id), eq(accounts.tenantId, tenantId)));
}
