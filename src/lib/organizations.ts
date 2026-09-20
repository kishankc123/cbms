import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { tenants, accounts, memberships, subscriptions } from "@/db/schema";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/ledger/default-chart-of-accounts";
import { logAuditEvent } from "@/lib/audit";
import { ensurePanRegistration } from "@/lib/compliance/registrations";
import { requirePan } from "@/lib/pan";

export type BusinessInfo = {
  name: string;
  businessType?: string;
  country?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** PAN / VAT number — one number. */
  panNumber?: string;
  companyRegistrationNumber?: string;
};

// CL-000001, CL-000002... — a human-readable support reference only.
async function nextClientCode(): Promise<string> {
  const [last] = await db.select({ code: tenants.clientCode }).from(tenants).where(isNotNull(tenants.clientCode)).orderBy(desc(tenants.clientCode)).limit(1);
  const n = last?.code ? parseInt(last.code.replace(/\D/g, ""), 10) || 0 : 0;
  return `CL-${String(n + 1).padStart(6, "0")}`;
}

/**
 * Creates an organization with its default setup (chart of accounts, trial
 * subscription) and makes `ownerUserId` its Owner — all in one transaction.
 */
export async function createOrganization(info: BusinessInfo, ownerUserId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const clientCode = await nextClientCode();
    try {
      const tenant = await db.transaction(async (tx) => {
        const [t] = await tx
          .insert(tenants)
          .values({
            clientCode,
            companyName: info.name.trim(),
            industry: info.businessType?.trim() || null,
            country: info.country?.trim() || null,
            address: info.address?.trim() || null,
            phone: info.phone?.trim() || null,
            email: info.email?.trim().toLowerCase() || null,
            panVatNumber: requirePan(info.panNumber, "PAN / VAT number"),
            companyRegistrationNumber: info.companyRegistrationNumber?.trim() || null,
            baseCurrency: "NPR",
          })
          .returning();

        await tx.insert(accounts).values(
          DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
            tenantId: t.id,
            code: a.code,
            name: a.name,
            category: a.category,
            subCategory: a.subCategory,
          }))
        );
        await tx.insert(memberships).values({ userId: ownerUserId, tenantId: t.id, role: "owner" });
        await tx.insert(subscriptions).values({ tenantId: t.id, plan: "trial", status: "trial", trialEndsAt: new Date(Date.now() + 30 * 86400000) });
        return t;
      });

      if (tenant.panVatNumber) await ensurePanRegistration(tenant.id);
      await logAuditEvent({ tenantId: tenant.id, userId: ownerUserId, action: "organization_created", entityType: "organization", entityId: tenant.id, after: { name: tenant.companyName, clientCode } });
      return tenant;
    } catch (e) {
      // Two signups racing for the same client code — retry with the next one.
      if (e instanceof Error && /client_code|unique/i.test(e.message) && attempt < 4) continue;
      throw e;
    }
  }
  throw new Error("Could not create the organization. Please try again.");
}
