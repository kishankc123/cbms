"use server";

import bcrypt from "bcryptjs";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, authTokens } from "@/db/schema";
import { hashToken } from "@/lib/tokens";
import { validatePassword } from "@/lib/password";
import { logAuditEvent } from "@/lib/audit";

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.type, "password_reset"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);

  if (!row) return { ok: false, error: "This reset link is invalid or has expired." };
  const pwError = validatePassword(newPassword);
  if (pwError) return { ok: false, error: pwError };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Bumping sessionVersion signs out every existing session; a reset also
  // clears any brute-force lockout.
  await db
    .update(users)
    .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`, failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, row.userId));
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  await logAuditEvent({ userId: row.userId, action: "password_reset", entityType: "user", entityId: row.userId });

  return { ok: true };
}
