import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, taxRates, tenants } from "@/db/schema";
import { addDays, todayIso } from "@/lib/calendar";

export type TaxTypeKey = "vat" | "tds";

/**
 * The rate in force on `date` — never today's rate for a backdated transaction. A rate change closes the old row
 * and opens a new one (see changeTaxRate), so this is a single lookup, not a running calculation. Falls back to the
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

  const [tenant] = await db.select({ vatRate: tenants.vatRate, tdsRate: tenants.tdsRate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return 0;
  return parseFloat((taxTypeKey === "vat" ? tenant.vatRate : tenant.tdsRate) ?? "0") || 0;
}

export async function getCurrentTaxRate(tenantId: string, taxTypeKey: TaxTypeKey): Promise<number> {
  return getTaxRate(tenantId, taxTypeKey, todayIso());
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

/**
 * Changes a tax rate from a given date onward. Rates form a single timeline — a new rate can only be added after
 * the one currently in force started, never inserted into the middle of history — so the sequence of what applied
 * when is never ambiguous. The old rate's row is closed the day before the new one starts; it is never edited or
 * deleted, so any transaction dated in its window (including one entered after the fact) still finds it.
 */
export async function changeTaxRate(tenantId: string, userId: string, input: { taxTypeKey: TaxTypeKey; rate: number; effectiveFrom: string; reason?: string }) {
  if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) throw new Error("Rate must be a number between 0 and 100");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || Number.isNaN(new Date(input.effectiveFrom + "T00:00:00Z").getTime())) {
    throw new Error("Enter a valid effective date");
  }

  const [currentRow] = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, input.taxTypeKey), isNull(taxRates.effectiveTo)))
    .limit(1);

  if (currentRow) {
    if (currentRow.source === "platform") {
      throw new Error("This rate is published by your administrator and can't be changed here");
    }
    if (input.effectiveFrom <= currentRow.effectiveFrom) {
      throw new Error(`The new rate must take effect after ${currentRow.effectiveFrom}, when the current rate started`);
    }
    if (Math.abs(Number(currentRow.rate) - input.rate) < 0.005) {
      throw new Error(`That is already the current rate (${Number(currentRow.rate)}%)`);
    }
  }

  await db.transaction(async (tx) => {
    if (currentRow) {
      await tx.update(taxRates).set({ effectiveTo: addDays(input.effectiveFrom, -1) }).where(eq(taxRates.id, currentRow.id));
    }
    await tx.insert(taxRates).values({
      tenantId,
      taxTypeKey: input.taxTypeKey,
      rate: input.rate.toFixed(2),
      effectiveFrom: input.effectiveFrom,
      source: "manual",
      createdBy: userId,
    });
  });

  await db.insert(auditLog).values({
    tenantId,
    userId,
    action: "tax_rate_changed",
    entityType: "tax_rate",
    entityId: input.taxTypeKey,
    beforeValue: currentRow ? { rate: Number(currentRow.rate), effectiveFrom: currentRow.effectiveFrom } : null,
    afterValue: { rate: input.rate, effectiveFrom: input.effectiveFrom, reason: input.reason?.trim() || null },
  });
}
