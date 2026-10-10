import { and, asc, count, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { memberships, roles, tenants, users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addedToOrganizationEmail, appUrl, isDeliveryFailure, sendEmail } from "@/lib/email";
import { isEmail } from "@/lib/password";
import { roleLabel } from "@/lib/roles";
import type { RoleRow } from "@/lib/role-store";

// The people in one organization, and how someone who already has an account is added to it. Plain server helpers (not
// server actions); the actions in settings/users check who is allowed to call them.

export const memberCode = (n: number | null) => (n ? `USR-${String(n).padStart(4, "0")}` : "—");

/** Gives every member without an ID the next number, in order of joining. Safe to call any number of times. */
export async function assignMemberNumbers(tenantId: string) {
  const [{ missing }] = await db.select({ missing: count() }).from(memberships).where(and(eq(memberships.tenantId, tenantId), isNull(memberships.memberNumber)));
  if (missing === 0) return;
  await db.execute(sql`
    update memberships m set member_number = base.top + r.rn
    from (select id, row_number() over (order by created_at, id) as rn from memberships where tenant_id = ${tenantId} and member_number is null) r,
         (select coalesce(max(member_number), 0) as top from memberships where tenant_id = ${tenantId}) base
    where m.id = r.id`);
}

export type MemberFilters = { search?: string; status?: string; roleId?: string; page: number; pageSize: number };

export async function listMembersPage(tenantId: string, f: MemberFilters) {
  await assignMemberNumbers(tenantId);
  const conditions: (SQL | undefined)[] = [eq(memberships.tenantId, tenantId)];
  const q = f.search?.trim();
  if (q) {
    const asNumber = q.match(/^(?:usr-?)?0*(\d+)$/i);
    conditions.push(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`), asNumber ? eq(memberships.memberNumber, Number(asNumber[1])) : undefined));
  }
  if (f.status === "active" || f.status === "suspended") conditions.push(eq(memberships.status, f.status));
  if (f.roleId) conditions.push(eq(memberships.roleId, f.roleId));
  const where = and(...conditions);
  const pageSize = Math.min(Math.max(f.pageSize, 1), 100);
  const page = Math.max(f.page, 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        userId: users.id,
        number: memberships.memberNumber,
        name: users.name,
        email: users.email,
        mobile: users.mobile,
        verified: users.emailVerifiedAt,
        lastLogin: users.lastLogin,
        baseRole: memberships.role,
        roleId: memberships.roleId,
        roleName: roles.name,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(roles, eq(roles.id, memberships.roleId))
      .where(where)
      .orderBy(asc(memberships.memberNumber))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(where),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({ ...r, code: memberCode(r.number), verified: Boolean(r.verified), lastLogin: r.lastLogin?.toISOString() ?? null, roleName: r.roleName ?? roleLabel(r.baseRole) })),
  };
}

export type AccountLookup = { state: "invalid" } | { state: "member"; name: string; roleName: string } | { state: "found"; name: string } | { state: "none" };

/**
 * What the Add user screen learns from an email. Only an account that is active with a verified email can be added
 * directly; an unverified account is reported exactly like no account at all, so this never reveals who has signed up.
 */
export async function lookupAccount(tenantId: string, email: string): Promise<AccountLookup> {
  const e = email.trim().toLowerCase();
  if (!isEmail(e)) return { state: "invalid" };
  const [user] = await db.select({ id: users.id, name: users.name, verified: users.emailVerifiedAt, status: users.status }).from(users).where(eq(users.email, e)).limit(1);
  if (!user) return { state: "none" };
  const [member] = await db
    .select({ roleName: roles.name, baseRole: memberships.role })
    .from(memberships)
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, user.id)))
    .limit(1);
  if (member) return { state: "member", name: user.name, roleName: member.roleName ?? roleLabel(member.baseRole) };
  if (user.verified && user.status === "active") return { state: "found", name: user.name };
  return { state: "none" };
}

export type AddResult = { ok: true; name: string; /** Set when the email telling them did not go: why. They are added either way. */ emailProblem?: string } | { ok: false; error: string };

/** Adds an existing, verified account to the organization at once, tells them by email, and leaves the in-app notice for next sign-in. */
export async function addExistingAccount(tenantId: string, adder: { userId: string; name: string }, input: { email: string; role: RoleRow; status: "active" | "suspended" }): Promise<AddResult> {
  const found = await lookupAccount(tenantId, input.email);
  if (found.state === "member") return { ok: false, error: `${found.name} already belongs to your organization as ${found.roleName}.` };
  if (found.state !== "found") return { ok: false, error: "No verified account found for this email. Send an invitation instead." };

  const email = input.email.trim().toLowerCase();
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { ok: false, error: "No verified account found for this email. Send an invitation instead." };

  try {
    const [m] = await db
      .insert(memberships)
      .values({ userId: user.id, tenantId, role: input.role.baseRole, roleId: input.role.id, status: input.status, addedBy: adder.userId })
      .returning({ id: memberships.id });
    await assignMemberNumbers(tenantId);
    await logAuditEvent({ tenantId, userId: adder.userId, action: "user_added", entityType: "membership", entityId: m.id, after: { userId: user.id, email, role: input.role.name, status: input.status } });
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    if (x?.code === "23505" || x?.cause?.code === "23505") return { ok: false, error: `${user.name} already belongs to your organization.` };
    throw e;
  }

  const [tenant] = await db.select({ name: tenants.companyName }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const sent = await sendEmail({ to: email, kind: "added_to_organization", tenantId, ...addedToOrganizationEmail(tenant?.name ?? "an organization", adder.name, input.role.name, `${appUrl()}/select-organization`) });
  return { ok: true, name: user.name, emailProblem: isDeliveryFailure(sent.status) ? sent.error : undefined };
}

// ---- the person's side: being told, and being able to leave

export async function listAddNotices(userId: string) {
  const rows = await db
    .select({ membershipId: memberships.id, tenantId: memberships.tenantId, orgName: tenants.companyName, roleName: roles.name, baseRole: memberships.role, addedByName: users.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(users, eq(users.id, memberships.addedBy))
    .where(and(eq(memberships.userId, userId), isNotNull(memberships.addedBy), isNull(memberships.noticeDismissedAt), eq(tenants.status, "active")));
  return rows.map((r) => ({ membershipId: r.membershipId, tenantId: r.tenantId, orgName: r.orgName, roleName: r.roleName ?? roleLabel(r.baseRole), addedByName: r.addedByName ?? "An administrator" }));
}

export async function dismissAddNotice(userId: string, membershipId: string) {
  await db.update(memberships).set({ noticeDismissedAt: new Date() }).where(and(eq(memberships.id, membershipId), eq(memberships.userId, userId)));
}

/** A person leaving an organization they were added to (or any they belong to), unless they are its last active Owner. */
export async function leaveOrganization(userId: string, membershipId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [m] = await db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.userId, userId))).limit(1);
  if (!m) return { ok: false, error: "Membership not found." };
  if (m.role === "owner" && m.status === "active") {
    const [{ owners }] = await db.select({ owners: count() }).from(memberships).where(and(eq(memberships.tenantId, m.tenantId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
    if (owners <= 1) return { ok: false, error: "You are the only Owner of this organization, so you can't leave it. Make someone else an Owner first." };
  }
  await db.delete(memberships).where(eq(memberships.id, m.id));
  await logAuditEvent({ tenantId: m.tenantId, userId, action: "user_left", entityType: "membership", entityId: m.id, before: { userId, role: m.role } });
  return { ok: true };
}
