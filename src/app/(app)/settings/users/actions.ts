"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users, invitations, tenants } from "@/db/schema";
import { ensureSystemRoles, getRole, listRoles, type RoleRow } from "@/lib/role-store";
import { requireTenantSession, requireUserSession, type AppSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { generateToken, hashToken } from "@/lib/tokens";
import { sendEmail, invitationEmail, appUrl, isEmailConfigured } from "@/lib/email";
import { isEmail } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function requireOrgAdmin(): Promise<AppSession> {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an Owner or Administrator can manage users.");
  return session;
}

// Only an Owner may grant the Owner role or change/remove an existing Owner. A role must be one of this organization's
// active roles.
async function loadAssignableRole(session: AppSession, roleId: string): Promise<RoleRow> {
  const role = await getRole(session.tenantId, roleId);
  if (!role) throw new Error("Choose a role.");
  if (!role.isActive) throw new Error(`The role "${role.name}" is inactive; choose another.`);
  if (role.baseRole === "owner" && session.role !== "owner") throw new Error("Only an Owner can assign the Owner role.");
  return role;
}

async function activeOwnerCount(tenantId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
  return value;
}

export async function listMembers() {
  const session = await requireOrgAdmin();
  const roleList = await listRoles(session.tenantId); // also links members to the standard roles on first use
  const [members, pending] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, roleId: memberships.roleId, status: memberships.status, verified: users.emailVerifiedAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, session.tenantId))
      .orderBy(users.name),
    db
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, roleId: invitations.roleId, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(eq(invitations.tenantId, session.tenantId), eq(invitations.status, "pending")))
      .orderBy(desc(invitations.createdAt)),
  ]);
  return {
    me: session.userId,
    myRole: session.role,
    roles: roleList.map((r) => ({ id: r.id, name: r.name, description: r.description ?? "", baseRole: r.baseRole, isActive: r.isActive })),
    members: members.map((m) => ({ ...m, verified: Boolean(m.verified) })),
    pending: pending.map((p) => ({ ...p, expiresAt: p.expiresAt.toISOString(), expired: p.expiresAt < new Date() })),
  };
}

export async function inviteUser(input: { email: string; roleId: string }): Promise<{ ok: true; devLink?: string } | { ok: false; error: string }> {
  const session = await requireOrgAdmin();
  const me = await requireUserSession();
  if (!me.emailVerifiedAt) return { ok: false, error: "Verify your own email address before inviting others." };
  if (!rateLimit(`invite:${session.userId}`, 20, 60 * 60 * 1000)) return { ok: false, error: "Too many invitations. Try again later." };

  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  let role: RoleRow;
  try {
    role = await loadAssignableRole(session, input.roleId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const [already] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, session.tenantId), eq(users.email, email)))
    .limit(1);
  if (already) return { ok: false, error: "This person already belongs to your organization." };

  // A newer invitation replaces any pending one for the same email.
  await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.tenantId, session.tenantId), eq(invitations.email, email), eq(invitations.status, "pending")));

  const token = generateToken();
  const [invite] = await db
    .insert(invitations)
    .values({ tenantId: session.tenantId, email, role: role.baseRole, roleId: role.id, tokenHash: hashToken(token), invitedBy: session.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning();

  const [tenant] = await db.select({ name: tenants.companyName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const link = `${appUrl()}/accept-invite/${token}`;
  await sendEmail({ to: email, ...invitationEmail(tenant.name, me.name, role.name, link) });
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "user_invited", entityType: "invitation", entityId: invite.id, after: { email, role: role.name } });

  revalidatePath("/settings/users");
  // Without an email provider (local development only) show the link so the
  // flow can still be tested.
  return { ok: true, devLink: !isEmailConfigured() && process.env.NODE_ENV !== "production" ? link : undefined };
}

export async function revokeInvitation(invitationId: string) {
  const session = await requireOrgAdmin();
  await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, session.tenantId), eq(invitations.status, "pending")));
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "invitation_revoked", entityType: "invitation", entityId: invitationId });
  revalidatePath("/settings/users");
}

async function loadTargetMember(session: AppSession, userId: string) {
  if (userId === session.userId) throw new Error("You can't change your own membership.");
  const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, session.tenantId), eq(memberships.userId, userId))).limit(1);
  if (!m) throw new Error("Member not found.");
  if (m.role === "owner" && session.role !== "owner") throw new Error("Only an Owner can change an Owner.");
  return m;
}

export async function changeMemberRole(userId: string, roleId: string) {
  const session = await requireOrgAdmin();
  const role = await loadAssignableRole(session, roleId);
  const m = await loadTargetMember(session, userId);
  if (m.role === "owner" && role.baseRole !== "owner" && (await activeOwnerCount(session.tenantId)) <= 1) {
    throw new Error("An organization must keep at least one Owner.");
  }
  const roleIds = await ensureSystemRoles(session.tenantId);
  const before = [...roleIds].find(([, id]) => id === m.roleId)?.[0] ?? m.role;
  // The role decides what the member can do, so any old per-member override is cleared.
  await db.update(memberships).set({ role: role.baseRole, roleId: role.id, permissions: null }).where(eq(memberships.id, m.id));
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "role_changed", entityType: "membership", entityId: m.id, before: { role: before, roleId: m.roleId }, after: { role: role.name, roleId: role.id, userId } });
  revalidatePath("/settings/users");
}

export async function setMemberStatus(userId: string, status: "active" | "suspended") {
  const session = await requireOrgAdmin();
  const m = await loadTargetMember(session, userId);
  if (m.role === "owner" && status === "suspended" && (await activeOwnerCount(session.tenantId)) <= 1) {
    throw new Error("An organization must keep at least one active Owner.");
  }
  await db.update(memberships).set({ status }).where(eq(memberships.id, m.id));
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: status === "suspended" ? "user_suspended" : "user_reactivated", entityType: "membership", entityId: m.id, after: { userId } });
  revalidatePath("/settings/users");
}

export async function removeMember(userId: string) {
  const session = await requireOrgAdmin();
  const m = await loadTargetMember(session, userId);
  if (m.role === "owner" && (await activeOwnerCount(session.tenantId)) <= 1) {
    throw new Error("An organization must keep at least one Owner.");
  }
  await db.delete(memberships).where(eq(memberships.id, m.id));
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "user_removed", entityType: "membership", entityId: m.id, before: { userId, role: m.role } });
  revalidatePath("/settings/users");
}
