import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { userAccountProblem, type UserAccountInput } from "@/lib/user-account-rules";
import { logAuditEvent } from "@/lib/audit";

// A person's own account, independent of any organization: they create it once, verify the email, and organizations then
// add them by that email. Plain server helpers (not server actions), so the rules can be tested without a request.

export async function createUserAccount(input: UserAccountInput): Promise<{ ok: true; userId: string; name: string; email: string } | { ok: false; error: string }> {
  const problem = userAccountProblem(input);
  if (problem) return { ok: false, error: problem };

  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, error: "An account with this email already exists. Sign in instead." };

  try {
    const [user] = await db
      .insert(users)
      .values({ name: input.fullName.trim(), email, mobile: input.mobile?.trim() || null, passwordHash: await bcrypt.hash(input.password, 12) })
      .returning();
    await logAuditEvent({ userId: user.id, action: "account_created", entityType: "user", entityId: user.id, after: { email, via: "user_registration" } });
    return { ok: true, userId: user.id, name: user.name, email: user.email };
  } catch (e) {
    // Two sign-ups racing for the same email.
    const x = e as { code?: string; cause?: { code?: string } };
    if (x?.code === "23505" || x?.cause?.code === "23505") return { ok: false, error: "An account with this email already exists. Sign in instead." };
    throw e;
  }
}
