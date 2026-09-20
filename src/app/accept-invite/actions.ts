"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { invitations, memberships, users } from "@/db/schema";
import { unstable_update } from "@/lib/auth";
import { loadInvitation, type LoadedInvitation } from "@/lib/invitations";
import { requireUserSession } from "@/lib/session";
import { validatePassword } from "@/lib/password";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";

async function completeAcceptance(invite: LoadedInvitation, userId: string) {
  await db
    .insert(memberships)
    .values({ userId, tenantId: invite.tenantId, role: invite.role })
    .onConflictDoNothing();
  await db.update(invitations).set({ status: "accepted", acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
  await logAuditEvent({ tenantId: invite.tenantId, userId, action: "invitation_accepted", entityType: "invitation", entityId: invite.id, after: { role: invite.role } });
}

// An existing account accepts while signed in as the invited email — the same
// account and password gain access to the new organization.
export async function acceptInviteExisting(token: string): Promise<{ ok: false; error: string } | void> {
  const invite = await loadInvitation(token);
  if (!invite) return { ok: false, error: "This invitation is invalid or has expired." };

  const user = await requireUserSession();
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return { ok: false, error: `This invitation is for ${invite.email}. Sign in with that account to accept it.` };
  }
  if (!user.emailVerifiedAt) return { ok: false, error: "Verify your email address first, then accept the invitation." };

  await completeAcceptance(invite, user.id);
  await unstable_update({ activeTenantId: invite.tenantId } as never);
  redirect("/dashboard");
}

// A brand-new person: the emailed link proves they own the address, so the
// account is created already verified.
export async function acceptInviteNew(
  token: string,
  input: { name: string; mobile?: string; password: string; confirmPassword: string }
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (!rateLimit(`accept:${await clientIp()}`, 10, 60 * 60 * 1000)) return { ok: false, error: "Too many attempts. Please try again later." };

  const invite = await loadInvitation(token);
  if (!invite) return { ok: false, error: "This invitation is invalid or has expired." };
  if (!input.name.trim()) return { ok: false, error: "Full name is required." };
  if (input.password !== input.confirmPassword) return { ok: false, error: "Passwords do not match." };
  const pwError = validatePassword(input.password);
  if (pwError) return { ok: false, error: pwError };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, invite.email.toLowerCase())).limit(1);
  if (existing) return { ok: false, error: "An account with this email already exists. Sign in to accept the invitation." };

  const [user] = await db
    .insert(users)
    .values({
      name: input.name.trim(),
      email: invite.email.toLowerCase(),
      mobile: input.mobile?.trim() || null,
      passwordHash: await bcrypt.hash(input.password, 12),
      emailVerifiedAt: new Date(),
    })
    .returning();
  await logAuditEvent({ userId: user.id, action: "account_created", entityType: "user", entityId: user.id, after: { via: "invitation" } });
  await completeAcceptance(invite, user.id);

  return { ok: true, email: user.email };
}
