import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { getAccountByRole, setAccountRole } from "@/lib/compliance/tax-accounts";
import { findControlAccount, createSubAccount } from "./control-accounts";
import { RETIREMENT_ACCOUNTS, type RetirementAccountKey } from "@/lib/payroll/retirement-pay";

// What payroll owes the retirement funds, one liability account per kind under a "Retirement Contributions Payable" group, and the employer's
// share as an expense. Code asks for an account by role ("payroll_retirement:employee_ssf"), so the account behind a role can be renamed.
// Accounts are only created when a run actually has something to post to them.

const roleOf = (key: RetirementAccountKey) => `payroll_retirement:${key}`;
const GROUP_CODE = "2360";
const GROUP_NAME = "Retirement Contributions Payable";

export async function getOrCreateRetirementGroup(tenantId: string) {
  const existing = await findControlAccount(tenantId, [GROUP_CODE], GROUP_NAME);
  if (existing) return existing;
  const [created] = await db.insert(accounts).values({ tenantId, code: GROUP_CODE, name: GROUP_NAME, category: "liability", subCategory: "Current liabilities" }).returning();
  return created;
}

export async function getOrCreateRetirementPayable(tenantId: string, key: RetirementAccountKey) {
  const mapped = await getAccountByRole(tenantId, roleOf(key));
  if (mapped) return mapped;
  const group = await getOrCreateRetirementGroup(tenantId);
  const name = RETIREMENT_ACCOUNTS[key];
  const [existing] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, group.id), eq(accounts.name, name))).limit(1);
  const account = existing ?? (await createSubAccount(tenantId, group, name));
  await setAccountRole(tenantId, roleOf(key), account.id);
  return account;
}

/** The employer's share of contributions as a cost, next to Salaries under Indirect expenses. */
export async function getOrCreateEmployerRetirementExpense(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["5210"], "Employer Retirement Contributions");
  if (existing) return existing;
  const [created] = await db.insert(accounts).values({ tenantId, code: "5210", name: "Employer Retirement Contributions", category: "expense", subCategory: "Indirect expenses" }).returning();
  return created;
}
