import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";

// People who currently belong to an organization (e.g. for assignee pickers).
export async function listOrgUsers(tenantId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")))
    .orderBy(asc(users.name));
}
