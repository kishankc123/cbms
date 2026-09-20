import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, tenants } from "@/db/schema";
import type { OrgRole } from "./roles";

export type OrgMembership = { tenantId: string; companyName: string; clientCode: string | null; role: OrgRole };

// Organizations a user may currently enter: active membership AND an active
// organization.
export async function listActiveMemberships(userId: string): Promise<OrgMembership[]> {
  const rows = await db
    .select({ tenantId: tenants.id, companyName: tenants.companyName, clientCode: tenants.clientCode, role: memberships.role })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"), eq(tenants.status, "active")))
    .orderBy(asc(tenants.companyName));
  return rows;
}

export async function hasActiveMembership(userId: string, tenantId: string): Promise<boolean> {
  const list = await listActiveMemberships(userId);
  return list.some((m) => m.tenantId === tenantId);
}
