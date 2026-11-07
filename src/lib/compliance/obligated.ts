import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, complianceRequirementTemplates, complianceTaxTypes, tenants, tenantTaxRegistrations } from "@/db/schema";
import { loadFacts } from "./engine/facts";
import { filterObligated, type ObligatedContext, type ObligationRef } from "./obligated-rules";

// Loads what decides which compliance items an organization is still obliged to (see obligated-rules.ts). Worked out once per request.
export const loadObligatedContext = cache(async (tenantId: string, today: string): Promise<ObligatedContext | null> => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return null;
  const [country] = await db.select({ isActive: complianceCountries.isActive }).from(complianceCountries).where(eq(complianceCountries.code, tenant.countryCode)).limit(1);
  const [templates, types, regs, facts] = await Promise.all([
    db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, tenant.countryCode)),
    db.select({ key: complianceTaxTypes.key, isActive: complianceTaxTypes.isActive, isRegistrable: complianceTaxTypes.isRegistrable }).from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, tenant.countryCode)),
    db.select({ key: tenantTaxRegistrations.taxTypeKey }).from(tenantTaxRegistrations).where(and(eq(tenantTaxRegistrations.tenantId, tenantId), eq(tenantTaxRegistrations.status, "active"))),
    loadFacts(tenant),
  ]);
  return {
    entityType: tenant.entityType,
    today,
    facts,
    countryActive: Boolean(country?.isActive),
    templates: new Map(templates.map((t) => [t.id, t])),
    taxTypes: new Map(types.map((t) => [t.key, t.isActive])),
    registrable: new Set(types.filter((t) => t.isRegistrable && t.isActive).map((t) => t.key)),
    activeRegistrations: new Set(regs.map((r) => r.key)),
  };
});

/**
 * The compliance items an organization is still obliged to: done items as they are, open ones only while the tax or permit is still published for the
 * country and still applies to the organization. Nothing is loaded when there is nothing open that could have gone stale.
 */
export async function onlyStillObligated<T extends ObligationRef>(tenantId: string, rows: T[], today: string): Promise<T[]> {
  const needsCheck = rows.some((r) => r.status !== "filed" && r.status !== "paid" && r.status !== "not_applicable" && r.source !== "manual");
  if (!needsCheck) return rows;
  const ctx = await loadObligatedContext(tenantId, today);
  return ctx ? filterObligated(rows, ctx) : rows;
}
