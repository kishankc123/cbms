"use server";

import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "@/db";
import { authTokens, users } from "@/db/schema";
import { hashToken, createAuthToken } from "@/lib/tokens";
import { requireUserSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail, verificationEmail, appUrl } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

export async function verifyEmail(token: string): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.type, "email_verification"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) return { ok: false, error: "This verification link is invalid or has expired." };

  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  await logAuditEvent({ userId: row.userId, action: "email_verified", entityType: "user", entityId: row.userId });
  return { ok: true };
}

export async function resendVerification(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUserSession();
  if (user.emailVerifiedAt) return { ok: true };
  if (!rateLimit(`verify:${user.id}`, 3, 60 * 60 * 1000)) return { ok: false, error: "Too many requests. Try again later." };

  const token = await createAuthToken(user.id, "email_verification", 24 * 60 * 60 * 1000);
  await sendEmail({ to: user.email, ...verificationEmail(user.name, `${appUrl()}/verify-email/${token}`) });
  return { ok: true };
}
