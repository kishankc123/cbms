import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { compliancePenaltyRules } from "@/db/schema";
import type { IsoDate } from "@/lib/calendar";
import type { PenaltyParams, TaxTypeKey } from "./penalty-engine";

/** The penalty rule in force on `date` for this tax type — never today's rule for a past period. null if none is configured. */
export async function getPenaltyRule<T extends TaxTypeKey>(countryCode: string, taxTypeKey: T, date: IsoDate): Promise<{ params: PenaltyParams<T>; isVerified: boolean; source: string | null } | null> {
  const [row] = await db
    .select()
    .from(compliancePenaltyRules)
    .where(
      and(
        eq(compliancePenaltyRules.countryCode, countryCode),
        eq(compliancePenaltyRules.taxTypeKey, taxTypeKey),
        lte(compliancePenaltyRules.effectiveFrom, date),
        or(isNull(compliancePenaltyRules.effectiveTo), gte(compliancePenaltyRules.effectiveTo, date))
      )
    )
    .limit(1);
  if (!row) return null;
  return { params: row.params as PenaltyParams<T>, isVerified: row.isVerified, source: row.source };
}
