import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, tenants } from "@/db/schema";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getCurrentTaxRate } from "../tax-rates";
import { activeRegisteredTaxTypes } from "../registrations";
import type { Facts } from "./applicability";

export type TenantProfile = typeof tenants.$inferSelect;

/**
 * The named facts the applicability engine evaluates templates against. They
 * are derived from data the system already holds — never a second manual flag
 * that could disagree with it (e.g. "has employees" is the payroll employee list).
 */
export async function loadFacts(tenant: TenantProfile): Promise<Facts> {
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenant.id), eq(employees.employmentStatus, "active")))
    .limit(1);

  // TDS has been withheld or is configured to be: a rate is set, or the TDS payable account exists.
  const [tdsAccount, tdsRate] = await Promise.all([findControlAccount(tenant.id, ["2320"], "TDS Payable"), getCurrentTaxRate(tenant.id, "tds")]);

  return {
    country_code: tenant.countryCode,
    entity_type: tenant.entityType,
    registered_tax_types: await activeRegisteredTaxTypes(tenant.id),
    has_employees: Boolean(employee),
    withholds_tax: tdsRate > 0 || Boolean(tdsAccount),
  };
}
