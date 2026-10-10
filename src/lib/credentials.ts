import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import type { SignInEvent } from "@/lib/sign-in-events";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// Used to spend the same time on unknown emails as on real ones.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8y0BqVxYvY8v8bKq0hQ8bXo0vJv7iG";

// Sign-in activity goes to the audit log, at platform level (signing in happens before any organization is chosen). Recording it never
// stops someone signing in, and a password is never part of it.
async function recordSignIn(action: SignInEvent, userId: string | null, after: Record<string, unknown>) {
  try {
    await logAuditEvent({ tenantId: null, userId, action, entityType: "user", entityId: userId ?? undefined, after });
  } catch (e) {
    console.error("could not record a sign-in event", e);
  }
}

export type SignedInUser = { id: string; name: string; email: string; sessionVersion: number; isPlatformAdmin: boolean; remember: boolean };

/**
 * Checks an email and password: returns the person on success, or null. Wrong passwords count towards a temporary lock, and every
 * outcome (signed in, failed and why, locked) goes to the audit log. A password is never recorded.
 */
export async function authorizeCredentials(credentials: Partial<Record<string, unknown>> | undefined): Promise<SignedInUser | null> {
  const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
  const password = credentials?.password as string | undefined;
  if (!email || !password) return null;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await recordSignIn("login_failed", null, { email: email.slice(0, 200), reason: "unknown_email" });
    return null;
  }
  if (user.status !== "active") {
    await recordSignIn("login_failed", user.id, { email, reason: "account_disabled" });
    return null;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordSignIn("login_failed", user.id, { email, reason: "account_locked" });
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(users)
      .set(failed >= MAX_FAILED_LOGINS ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { failedLoginCount: failed })
      .where(eq(users.id, user.id));
    await recordSignIn("login_failed", user.id, { email, reason: "wrong_password", failedInARow: failed >= MAX_FAILED_LOGINS ? MAX_FAILED_LOGINS : failed });
    if (failed >= MAX_FAILED_LOGINS) await recordSignIn("account_locked", user.id, { email, lockedForMinutes: LOCKOUT_MS / 60000 });
    return null;
  }

  await db.update(users).set({ lastLogin: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await recordSignIn("login_succeeded", user.id, { email, remember: credentials?.remember === "true" });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    sessionVersion: user.sessionVersion,
    isPlatformAdmin: user.isPlatformAdmin,
    remember: credentials?.remember === "true",
  };
}
