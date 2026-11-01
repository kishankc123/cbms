import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { taxRates } from "@/db/schema";
import { addDays } from "@/lib/calendar";

/**
 * Gives a test organization a tax rate of its own from a date: the open rate ends the day before and the new one opens.
 * Organizations can't do this in the app (only a platform administrator publishes rates), so a test that needs a rate history
 * sets it up here.
 */
export async function setOwnTaxRate(tenantId: string, userId: string, input: { taxTypeKey: "vat" | "tds"; rate: number; effectiveFrom: string }) {
  const [open] = await db.select().from(taxRates).where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, input.taxTypeKey), isNull(taxRates.effectiveTo))).limit(1);
  await db.transaction(async (tx) => {
    if (open) await tx.update(taxRates).set({ effectiveTo: addDays(input.effectiveFrom, -1) }).where(eq(taxRates.id, open.id));
    await tx.insert(taxRates).values({ tenantId, taxTypeKey: input.taxTypeKey, rate: input.rate.toFixed(2), effectiveFrom: input.effectiveFrom, source: "manual", createdBy: userId });
  });
}
