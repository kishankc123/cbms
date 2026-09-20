import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tenantTaxRegistrations } from "@/db/schema";

/** Tax types (by key) for which the organization holds an ACTIVE registration. */
export async function activeRegisteredTaxTypes(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ key: tenantTaxRegistrations.taxTypeKey })
    .from(tenantTaxRegistrations)
    .where(and(eq(tenantTaxRegistrations.tenantId, tenantId), eq(tenantTaxRegistrations.status, "active")));
  return rows.map((r) => r.key);
}

/**
 * The organization's PAN/VAT number is one number in one place. Setting it makes
 * the organization PAN-registered (a PAN registration is created if there is none).
 * VAT registration is a separate, explicit decision (Tax Registrations) — having a
 * PAN does not by itself make an organization VAT-registered.
 */
export async function ensurePanRegistration(tenantId: string) {
  await db.insert(tenantTaxRegistrations).values({ tenantId, taxTypeKey: "pan", status: "active" }).onConflictDoNothing();
}
