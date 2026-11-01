import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceTaxHeads, tenants } from "@/db/schema";
import { getAccountByRole, setAccountRole } from "@/lib/compliance/tax-accounts";
import { createSubAccount } from "./control-accounts";
import { getOrCreateTdsPayableAccount } from "./expense-accounts";

// TDS withheld is owed to the tax office, and each heading (Salary, Rent, Services...) has its own payable account under TDS Payable, so a deposit
// clears exactly what was withheld for the heading it pays. Code asks for the account by heading; the account behind a role can be renamed.

const roleOf = (headKey: string) => `tds_payable:${headKey}`;

/** The name a heading's payable account carries: "TDS Payable — Rent". Payroll's is "Salary", as the salary TDS account has always been named. */
async function accountNameFor(tenantId: string, headKey: string) {
  const [row] = await db
    .select({ name: complianceTaxHeads.name, module: complianceTaxHeads.module })
    .from(complianceTaxHeads)
    .innerJoin(tenants, eq(tenants.countryCode, complianceTaxHeads.countryCode))
    .where(and(eq(tenants.id, tenantId), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.key, headKey)))
    .limit(1);
  return `TDS Payable — ${row?.module === "payroll" ? "Salary" : row?.name ?? headKey}`;
}

/** The payable account for a TDS heading, created under TDS Payable when it does not exist yet. */
export async function getOrCreateTdsHeadPayableAccount(tenantId: string, headKey: string) {
  const mapped = await getAccountByRole(tenantId, roleOf(headKey));
  if (mapped) return mapped;
  const parent = await getOrCreateTdsPayableAccount(tenantId);
  const name = await accountNameFor(tenantId, headKey);
  const [existing] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, parent.id), eq(accounts.name, name))).limit(1);
  const account = existing ?? (await createSubAccount(tenantId, parent, name));
  await setAccountRole(tenantId, roleOf(headKey), account.id);
  return account;
}

/** The heading payroll files salary TDS under in this organization's country (the one worked out from slabs in the payroll module), if any. */
export async function payrollTdsHeadKey(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ key: complianceTaxHeads.key })
    .from(complianceTaxHeads)
    .innerJoin(tenants, eq(tenants.countryCode, complianceTaxHeads.countryCode))
    .where(and(eq(tenants.id, tenantId), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.module, "payroll"), eq(complianceTaxHeads.isActive, true)))
    .limit(1);
  return row?.key ?? null;
}
