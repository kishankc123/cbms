import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tenantTaxRegistrations, tenants } from "@/db/schema";
import { bsFiscalYearOf } from "@/lib/calendar";
import type { StartDates } from "./engine/start-dates";
import { profileGaps, startDatesOf, type ProfileGap, type ProfileInput } from "./profile-rules";

export type { ProfileGap, ProfileInput };
export { profileGaps, startDatesOf };

// Whether the organization has told us enough about itself for compliance to start. Until it has, nothing is generated: a
// deadline worked out from missing facts would be a guess. Pure rules first, then the loader that reads the database.

export type ComplianceProfile = {
  complete: boolean;
  gaps: ProfileGap[];
  starts: StartDates;
  /** The fiscal year the company was registered in, e.g. "2078/79" (Shrawan to Ashadh). */
  firstFiscalYear: string | null;
};

export async function loadComplianceProfile(tenantId: string): Promise<ComplianceProfile> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");
  const registrations = await db
    .select({ taxTypeKey: tenantTaxRegistrations.taxTypeKey, status: tenantTaxRegistrations.status, effectiveDate: tenantTaxRegistrations.effectiveDate, filingFrequency: tenantTaxRegistrations.filingFrequency })
    .from(tenantTaxRegistrations)
    .where(and(eq(tenantTaxRegistrations.tenantId, tenantId)));
  const input: ProfileInput = { entityType: tenant.entityType, panVatNumber: tenant.panVatNumber, companyRegistrationDate: tenant.registrationDate, registrations };
  const gaps = profileGaps(input);
  return {
    complete: gaps.length === 0,
    gaps,
    starts: startDatesOf(input),
    firstFiscalYear: tenant.registrationDate ? bsFiscalYearOf(tenant.registrationDate)?.label ?? null : null,
  };
}
