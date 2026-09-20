import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { ensurePanRegistration } from "@/lib/compliance/registrations";

export const COMPANY_STATUSES = ["active", "dormant", "closed", "other"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export type CompanyProfilePatch = Partial<{
  companyName: string;
  tradingName: string | null;
  companyRegistrationNumber: string | null;
  registrationDate: string | null;
  panVatNumber: string | null;
  registeredOffice: string | null;
  address: string | null;
  industry: string | null;
  baseCurrency: string;
  countryCode: string;
  entityType: string | null;
  companyStatus: CompanyStatus;
  companyStatusNote: string | null;
}>;

/**
 * The one place an organization's company profile is written, whichever screen
 * (Settings or Compliance > Company Details) it is edited from — so the two can
 * never disagree. It records what changed (before/after) in the audit log, which
 * is what Compliance History reads, and keeps the PAN registration in step with
 * the PAN/VAT number.
 */
export async function saveCompanyProfile(tenantId: string, userId: string, patch: CompanyProfilePatch) {
  if (patch.companyName !== undefined && !patch.companyName.trim()) throw new Error("Company name is required");
  if (patch.companyStatus !== undefined && !COMPANY_STATUSES.includes(patch.companyStatus)) throw new Error("Unknown company status");

  const [before] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!before) throw new Error("Organization not found");

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(patch)) {
    const prev = (before as Record<string, unknown>)[key] ?? null;
    const next = typeof value === "string" ? value.trim() || null : value ?? null;
    if (prev !== next) changed[key] = { from: prev, to: next };
  }
  if (Object.keys(changed).length === 0) return { changed };

  const set: Record<string, unknown> = {};
  for (const [key, c] of Object.entries(changed)) set[key] = c.to;
  // Non-nullable columns keep their value rather than being blanked.
  if ("companyName" in set && !set.companyName) delete set.companyName;
  if ("baseCurrency" in set && !set.baseCurrency) delete set.baseCurrency;
  if ("countryCode" in set && !set.countryCode) delete set.countryCode;
  if ("companyStatus" in set && !set.companyStatus) delete set.companyStatus;

  await db.update(tenants).set(set).where(eq(tenants.id, tenantId));
  if (typeof set.panVatNumber === "string") await ensurePanRegistration(tenantId);

  await logAuditEvent({
    tenantId,
    userId,
    action: "company_details_changed",
    entityType: "company_details",
    entityId: tenantId,
    before: Object.fromEntries(Object.entries(changed).map(([k, c]) => [k, c.from])),
    after: Object.fromEntries(Object.entries(changed).map(([k, c]) => [k, c.to])),
  });
  return { changed };
}
