import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { taxRates, tenants } from "@/db/schema";
import { todayIso } from "@/lib/calendar";

/** "vat", "income_tax", or a TDS heading's key such as "tds.rent" (the old single "tds" rate is only still read as a fallback). */
export type TaxTypeKey = string;

/**
 * The rate in force on `date` — never today's rate for a backdated transaction. A rate change closes the old row
 * and opens a new one (see platform-tax-rates), so this is a single lookup, not a running calculation. Falls back to the
 * legacy single-value tenant field only for a tenant whose rate history has not been seeded yet.
 */
export async function getTaxRate(tenantId: string, taxTypeKey: TaxTypeKey, date: string): Promise<number> {
  const [row] = await db
    .select({ rate: taxRates.rate })
    .from(taxRates)
    .where(
      and(
        eq(taxRates.tenantId, tenantId),
        eq(taxRates.taxTypeKey, taxTypeKey),
        lte(taxRates.effectiveFrom, date),
        or(isNull(taxRates.effectiveTo), gte(taxRates.effectiveTo, date))
      )
    )
    .limit(1);
  if (row) return Number(row.rate);

  // Only the two original rates have a fallback; a heading with no published rate has none.
  if (taxTypeKey !== "vat" && taxTypeKey !== "tds") return 0;
  const [tenant] = await db.select({ vatRate: tenants.vatRate, tdsRate: tenants.tdsRate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return 0;
  return parseFloat((taxTypeKey === "vat" ? tenant.vatRate : tenant.tdsRate) ?? "0") || 0;
}

export async function getCurrentTaxRate(tenantId: string, taxTypeKey: TaxTypeKey): Promise<number> {
  return getTaxRate(tenantId, taxTypeKey, todayIso());
}

/** The rate row in force for one key, or null when the organization has none (a TDS heading nobody has published a rate for yet). */
export async function getOpenTaxRate(tenantId: string, taxTypeKey: TaxTypeKey): Promise<{ rate: number; source: "manual" | "platform"; effectiveFrom: string } | null> {
  const [row] = await db.select().from(taxRates).where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, taxTypeKey), isNull(taxRates.effectiveTo))).limit(1);
  return row ? { rate: Number(row.rate), source: row.source as "manual" | "platform", effectiveFrom: row.effectiveFrom } : null;
}

export type TaxRateSource = "manual" | "platform";
export type TaxRateRow = { id: string; rate: number; effectiveFrom: string; effectiveTo: string | null; source: TaxRateSource };

/**
 * The rate in force right now, and who set it — "manual" (the organization) or "platform" (a platform
 * administrator publishing a country-wide rate; not built yet). The UI uses `source` to decide whether to offer a
 * "Change rate" action at all, without needing to know anything else about how the rate arrived.
 */
export async function getCurrentTaxRateInfo(tenantId: string, taxTypeKey: TaxTypeKey): Promise<{ rate: number; source: TaxRateSource; effectiveFrom: string | null }> {
  const [row] = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, taxTypeKey), isNull(taxRates.effectiveTo)))
    .limit(1);
  if (row) return { rate: Number(row.rate), source: row.source as TaxRateSource, effectiveFrom: row.effectiveFrom };
  return { rate: await getCurrentTaxRate(tenantId, taxTypeKey), source: "manual", effectiveFrom: null };
}

/** Every rate this tax type has ever had, newest first. */
export async function getTaxRateHistory(tenantId: string, taxTypeKey: TaxTypeKey): Promise<TaxRateRow[]> {
  const rows = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, taxTypeKey)))
    .orderBy(desc(taxRates.effectiveFrom));
  return rows.map((r) => ({ id: r.id, rate: Number(r.rate), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, source: r.source as TaxRateSource }));
}
