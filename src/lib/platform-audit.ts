import { and, desc, eq, inArray, isNull, notInArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { describeSignInEvent, SIGN_IN_EVENTS } from "@/lib/sign-in-events";

export type PlatformAuditKind = "all" | "sign_ins" | "failed" | "changes";
export const PLATFORM_AUDIT_KINDS: { key: PlatformAuditKind; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "sign_ins", label: "Sign-ins" },
  { key: "failed", label: "Failed sign-ins" },
  { key: "changes", label: "Platform changes" },
];

export type PlatformAuditRow = { id: string; at: string; who: string; action: string; what: string; before: string | null; after: string | null };

const compact = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return String(v);
  const e = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)}`);
  return e.length ? e.join(", ") : null;
};

/** The platform-level audit log (events that belong to no organization): sign-ins and what platform administrators changed. */
export async function listPlatformAudit(kind: PlatformAuditKind, limit = 300): Promise<PlatformAuditRow[]> {
  const conditions: SQL[] = [isNull(auditLog.tenantId)];
  if (kind === "sign_ins") conditions.push(inArray(auditLog.action, SIGN_IN_EVENTS));
  if (kind === "failed") conditions.push(inArray(auditLog.action, ["login_failed", "account_locked"]));
  if (kind === "changes") conditions.push(notInArray(auditLog.action, SIGN_IN_EVENTS));
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.timestamp, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId, before: auditLog.beforeValue, after: auditLog.afterValue, name: users.name, email: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.timestamp))
    .limit(limit);
  return rows.map((r) => {
    const signIn = describeSignInEvent(r.action, r.after);
    const attempted = (r.after as { email?: string } | null)?.email;
    return {
      id: r.id,
      at: r.at.toISOString(),
      who: r.name ? `${r.name} (${r.email})` : attempted ?? "—",
      action: r.action,
      what: signIn ?? `${r.entityType}${r.entityId ? ` ${r.entityId.slice(0, 40)}` : ""}`,
      before: signIn ? null : compact(r.before),
      after: signIn ? (attempted && !r.name ? `email tried: ${attempted}` : null) : compact(r.after),
    };
  });
}
