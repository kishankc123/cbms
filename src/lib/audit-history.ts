import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { listOrgUsers } from "@/lib/org-users";

export type EditHistoryEntry = {
  id: string;
  at: string;
  userName: string;
  action: string;
  /** What changed, one line per field. */
  changes: { field: string; before: string; after: string }[];
};

/**
 * The edits made to one record (a payment, a transfer), newest first, from the audit log: who, when, and what each field was
 * before and after. Edits are logged with only the fields that changed (see updatePayment / updateTransfer).
 */
export async function listEditHistory(tenantId: string, entityType: string, entityId: string): Promise<EditHistoryEntry[]> {
  const [rows, users] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.timestamp)),
    listOrgUsers(tenantId),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const before = (r.beforeValue ?? {}) as Record<string, unknown>;
    const after = (r.afterValue ?? {}) as Record<string, unknown>;
    const fields = Object.keys(after).filter((k) => k !== "paymentNumber" && k !== "transferNumber");
    return {
      id: r.id,
      at: r.timestamp.toISOString(),
      userName: r.userId ? nameById.get(r.userId) ?? "—" : "System",
      action: r.action,
      changes: fields.map((f) => ({ field: f, before: String(before[f] ?? "—"), after: String(after[f] ?? "—") })),
    };
  });
}
