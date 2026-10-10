"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users, invitations, tenants } from "@/db/schema";
import { ensureSystemRoles, getRole, listRoles, type RoleRow } from "@/lib/role-store";
import { addExistingAccount, listMembersPage, lookupAccount, memberCode, type AccountLookup, type AddResult } from "@/lib/org-members";
import { requireTenantSession, requireUserSession, type AppSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { generateToken, hashToken } from "@/lib/tokens";
import { sendEmail, invitationEmail, appUrl, isDeliveryFailure } from "@/lib/email";
import { isEmail } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { transferOwnership } from "@/lib/org-ownership";

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

export async function getUsersPage(params: { search?: string; status?: string; roleId?: string; page?: number; pageSize?: number }) {
  const session = await requireOrgAdmin();
  const roleList = await listRoles(session.tenantId); // also links members to the standard roles on first use
  const pageSize = [25, 50, 100].includes(params.pageSize ?? 0) ? params.pageSize! : 25;
  const [list, pending] = await Promise.all([
    listMembersPage(session.tenantId, { search: params.search, status: params.status, roleId: params.roleId, page: params.page ?? 1, pageSize }),
    db
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, roleId: invitations.roleId, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(eq(invitations.tenantId, session.tenantId), eq(invitations.status, "pending")))
      .orderBy(desc(invitations.createdAt)),
  ]);
  return {
    me: session.userId,
    myRole: session.role,
    roles: roleList.map((r) => ({ id: r.id, name: r.name, baseRole: r.baseRole, isActive: r.isActive })),
    list,
    pending: pending.map((p) => ({ id: p.id, email: p.email, roleName: roleList.find((r) => r.id === p.roleId)?.name ?? p.role, expiresAt: p.expiresAt.toISOString(), expired: p.expiresAt < new Date() })),
  };
}
export type UsersPage = Awaited<ReturnType<typeof getUsersPage>>;

/** The roles this person may hand out: active ones, and Owner only if they are an Owner themselves. */
export async function getAddUserData() {
  const session = await requireOrgAdmin();
  const roleList = await listRoles(session.tenantId);
  return {
    roles: roleList.filter((r) => r.isActive && (r.baseRole !== "owner" || session.role === "owner")).map((r) => ({ id: r.id, name: r.name, description: r.description ?? "" })),
  };
}
export type AddUserData = Awaited<ReturnType<typeof getAddUserData>>;

export async function findAccount(email: string): Promise<AccountLookup> {
  const session = await requireOrgAdmin();
  if (!rateLimit(`lookup:${session.userId}`, 40, 60 * 60 * 1000)) throw new Error("Too many lookups. Try again later.");
  return lookupAccount(session.tenantId, email);
}

/** Adds an existing, verified account straight away (the role and status are the organization's to set). */
export async function addUser(input: { email: string; roleId: string; status: "active" | "suspended" }): Promise<AddResult> {
  const session = await requireOrgAdmin();
  const me = await requireUserSession();
  if (!me.emailVerifiedAt) return { ok: false, error: "Verify your own email address before adding others." };
  if (!rateLimit(`add-user:${session.userId}`, 30, 60 * 60 * 1000)) return { ok: false, error: "Too many additions. Try again later." };
  if (input.status !== "active" && input.status !== "suspended") return { ok: false, error: "Choose a status." };
  let role: RoleRow;
  try {
    role = await loadAssignableRole(session, input.roleId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const result = await addExistingAccount(session.tenantId, { userId: session.userId, name: me.name }, { email: input.email, role, status: input.status });
  if (result.ok) revalidatePath("/settings/users");
  return result;
}

/** The Owner hands the organization over to another member and steps down (see lib/org-ownership.ts). Needs the Owner's password. */
export async function handOverOwnership(input: { toUserId: string; password: string; stepDownRoleId: string | null }) {
  const session = await requireOrgAdmin();
  if (session.role !== "owner") return { ok: false as const, error: "Only an Owner can hand the organization over." };
  const r = await transferOwnership({ tenantId: session.tenantId, actingUserId: session.userId, toUserId: input.toUserId, password: input.password, stepDownRoleId: input.stepDownRoleId });
  if (r.ok) {
    revalidatePath("/settings", "layout");
    revalidatePath("/settings/users");
  }
  return r;
}

export async function getMemberForEdit(userId: string) {
  const session = await requireOrgAdmin();
  await listRoles(session.tenantId);
  const [row] = await db
    .select({ userId: users.id, number: memberships.memberNumber, name: users.name, email: users.email, mobile: users.mobile, verified: users.emailVerifiedAt, baseRole: memberships.role, roleId: memberships.roleId, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, session.tenantId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) return null;
  const roleList = await listRoles(session.tenantId);
  const isMe = row.userId === session.userId;
  return {
    member: { ...row, code: memberCode(row.number), verified: Boolean(row.verified) },
    isMe,
    // An Administrator can't touch an Owner, and nobody edits their own membership here.
    locked: isMe || (row.baseRole === "owner" && session.role !== "owner"),
    roles: roleList.filter((r) => (r.isActive || r.id === row.roleId) && (r.baseRole !== "owner" || session.role === "owner" || r.id === row.roleId)).map((r) => ({ id: r.id, name: r.name })),
  };
}
export type MemberForEdit = NonNullable<Awaited<ReturnType<typeof getMemberForEdit>>>;

export async function inviteUser(input: { email: string; roleId: string }): Promise<{ ok: true; devLink?: string; /** Set when the invitation email did not go: why, in words a person can act on. */ emailProblem?: string } | { ok: false; error: string }> {
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
  const sent = await sendEmail({ to: email, kind: "invitation", tenantId: session.tenantId, ...invitationEmail(tenant.name, me.name, role.name, link) });
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "user_invited", entityType: "invitation", entityId: invite.id, after: { email, role: role.name } });

  revalidatePath("/settings/users");
  // When the email did not go (no provider in development, or a real failure), show the link so the invitation can still be passed on.
  return { ok: true, devLink: sent.delivered ? undefined : link, emailProblem: isDeliveryFailure(sent.status) ? sent.error : undefined };
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
  await db.update(memberships).set({ role: role.baseRole, roleId: role.id }).where(eq(memberships.id, m.id));
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
