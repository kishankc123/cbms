import { db } from "@/db";
import { auditLog } from "@/db/schema";

// Account/organization security events (account created, invitations, role
// changes, switches, password changes...). tenantId is null for events that
// aren't scoped to one organization.
export async function logAuditEvent(input: {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}) {
  await db.insert(auditLog).values({
    tenantId: input.tenantId ?? null,
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeValue: input.before as never,
    afterValue: input.after as never,
  });
}
