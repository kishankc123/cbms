import { eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, tenants } from "@/db/schema";

/**
 * Moves a test organization to a throwaway country that has no salary-tax slabs, so payroll tests that check exact pay are not
 * affected by whatever slabs are published for the real country in the database. Call the returned function after `org.remove()`.
 */
export async function useCountryWithoutSlabs(tenantId: string, code: string): Promise<() => Promise<void>> {
  await db.insert(complianceCountries).values({ code, name: "Test country without slabs", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1, isActive: false }).onConflictDoNothing();
  await db.update(tenants).set({ countryCode: code }).where(eq(tenants.id, tenantId));
  return async () => {
    await db.delete(complianceCountries).where(eq(complianceCountries.code, code));
  };
}
