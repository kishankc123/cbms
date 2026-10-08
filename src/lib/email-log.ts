import { and, count, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { emailLog, tenants } from "@/db/schema";
import { isDeliveryFailure } from "@/lib/email";
import { EMAIL_KIND_LABEL } from "@/lib/email-log-labels";

// The sent-mail log: every email the system tried to send and whether it went. Plain server helpers; the platform admin screen
// checks requirePlatformAdmin before calling the listing.

export { EMAIL_KIND_LABEL };

/**
 * Why the person's latest verification email did not go, if it did not, so the verify banner can say so instead of leaving them
 * waiting. Only looks at the last week; null when it went, or when there is nothing to report.
 */
export async function verificationEmailProblem(email: string): Promise<string | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ status: emailLog.status, error: emailLog.error })
    .from(emailLog)
    .where(and(eq(emailLog.toEmail, email.trim().toLowerCase()), eq(emailLog.kind, "verification"), gte(emailLog.createdAt, since)))
    .orderBy(desc(emailLog.createdAt))
    .limit(1);
  return row && isDeliveryFailure(row.status) ? row.error ?? "The email could not be sent." : null;
}

export type EmailFilters = { status?: string; kind?: string; search?: string; page: number; pageSize: number };

export async function listEmailLog(f: EmailFilters) {
  const conditions: (SQL | undefined)[] = [];
  if (f.status === "sent" || f.status === "failed" || f.status === "not_configured") conditions.push(eq(emailLog.status, f.status));
  if (f.kind && EMAIL_KIND_LABEL[f.kind]) conditions.push(eq(emailLog.kind, f.kind));
  const q = f.search?.trim();
  if (q) conditions.push(or(ilike(emailLog.toEmail, `%${q}%`), ilike(emailLog.subject, `%${q}%`)));
  const where = conditions.length ? and(...conditions) : undefined;
  const pageSize = Math.min(Math.max(f.pageSize, 1), 100);
  const page = Math.max(f.page, 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: emailLog.id, toEmail: emailLog.toEmail, kind: emailLog.kind, subject: emailLog.subject, status: emailLog.status, error: emailLog.error, providerId: emailLog.providerId, createdAt: emailLog.createdAt, organization: tenants.companyName })
      .from(emailLog)
      .leftJoin(tenants, eq(tenants.id, emailLog.tenantId))
      .where(where)
      .orderBy(desc(emailLog.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(emailLog).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total, page, pageSize };
}

/** How the last 24 hours went, for the top of the screen. */
export async function emailLog24h() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select({ status: emailLog.status, n: sql<number>`count(*)::int` }).from(emailLog).where(gte(emailLog.createdAt, since)).groupBy(emailLog.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { sent: by.sent ?? 0, failed: by.failed ?? 0, notConfigured: by.not_configured ?? 0 };
}
