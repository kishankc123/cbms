"use server";

import { requireTenantSession, can } from "@/lib/session";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceTaxHeads, tenants } from "@/db/schema";
import { BASE_RATE_TYPES, headRateKey } from "@/lib/compliance/platform-tax-rate-types";
import { getOpenTaxRate, getCurrentTaxRateInfo, getTaxRateHistory, type TaxTypeKey } from "@/lib/compliance/tax-rates";

export type RateLine = { key: string; label: string; group: string | null; slabs: boolean; rate: number | null; since: string | null };

/** Every rate that applies to this organization: VAT and Income tax, then TDS by heading. A rate nobody has published yet comes back as null. */
export async function getTaxRatesOverview(): Promise<RateLine[]> {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const heads = await db
    .select()
    .from(complianceTaxHeads)
    .where(and(eq(complianceTaxHeads.countryCode, tenant.countryCode), eq(complianceTaxHeads.isActive, true)))
    .orderBy(asc(complianceTaxHeads.sortOrder), asc(complianceTaxHeads.name));
  const lines = [
    ...BASE_RATE_TYPES.map((t) => ({ key: t.key, label: t.label, group: null, slabs: false })),
    ...heads.map((h) => ({ key: headRateKey(h.taxTypeKey, h.key), label: h.name, group: h.taxTypeKey.toUpperCase(), slabs: h.kind === "slabs" })),
  ];
  return Promise.all(
    lines.map(async (l) => {
      const open = l.slabs ? null : await getOpenTaxRate(session.tenantId, l.key);
      return { ...l, rate: open?.rate ?? null, since: open?.effectiveFrom ?? null };
    })
  );
}

export async function getTaxRateInfo(taxTypeKey: TaxTypeKey) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  return getCurrentTaxRateInfo(session.tenantId, taxTypeKey);
}

export async function listTaxRateHistory(taxTypeKey: TaxTypeKey) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  return getTaxRateHistory(session.tenantId, taxTypeKey);
}
