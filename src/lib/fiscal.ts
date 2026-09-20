import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import type { DateRange } from "@/lib/calendar";

/** The organization's configured fiscal year as real AD boundaries (independent of AD/BS display). */
export async function getFiscalRange(tenantId: string): Promise<DateRange | null> {
  const [row] = await db
    .select({ from: tenants.fiscalYearStartDate, to: tenants.fiscalYearEndDate })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.from && row?.to ? { from: row.from, to: row.to } : null;
}
