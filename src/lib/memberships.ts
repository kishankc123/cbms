import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, roles, tenants } from "@/db/schema";
import { roleLabel, type OrgRole } from "./roles";

export type OrgMembership = { tenantId: string; companyName: string; clientCode: string | null; role: OrgRole; roleName: string };

// Organizations a user may currently enter: active membership AND an active
// organization.
export async function listActiveMemberships(userId: string): Promise<OrgMembership[]> {
  const rows = await db
    .select({ tenantId: tenants.id, companyName: tenants.companyName, clientCode: tenants.clientCode, role: memberships.role, roleName: roles.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"), eq(tenants.status, "active")))
    .orderBy(asc(tenants.companyName));
  return rows.map((r) => ({ ...r, roleName: r.roleName ?? roleLabel(r.role) }));
}

export async function hasActiveMembership(userId: string, tenantId: string): Promise<boolean> {
  const list = await listActiveMemberships(userId);
  return list.some((m) => m.tenantId === tenantId);
}
