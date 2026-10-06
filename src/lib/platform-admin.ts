import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, memberships, roles, subscriptions, tenants, users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { roleLabel } from "@/lib/roles";

// What the platform administrator sees and controls across every organization. Plain server helpers (not server actions):
// the actions in app/admin check requirePlatformAdmin before calling anything here. Platform-level audit events are
// written with no tenant, so they can be listed together.

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ------------------------------------------------------------------ users

export type UserFilters = { search?: string; status?: string; admins?: boolean; page: number; pageSize: number };

export async function listPlatformUsers(f: UserFilters) {
  const conditions: (SQL | undefined)[] = [];
  const q = f.search?.trim();
  if (q) conditions.push(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`), ilike(users.mobile, `%${q}%`)));
  if (f.status === "active" || f.status === "disabled" || f.status === "invited") conditions.push(eq(users.status, f.status));
  if (f.admins) conditions.push(eq(users.isPlatformAdmin, true));
  const where = conditions.length ? and(...conditions) : undefined;
  const pageSize = Math.min(Math.max(f.pageSize, 1), 100);
  const page = Math.max(f.page, 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        mobile: users.mobile,
        status: users.status,
        verifiedAt: users.emailVerifiedAt,
        isPlatformAdmin: users.isPlatformAdmin,
        lockedUntil: users.lockedUntil,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        organizations: sql<number>`(select count(*)::int from memberships m where m.user_id = "users"."id")`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({ ...r, verified: Boolean(r.verifiedAt), locked: Boolean(r.lockedUntil && r.lockedUntil > new Date()), lastLogin: r.lastLogin?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })),
  };
}

export async function getPlatformUser(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const [orgs, events] = await Promise.all([
    db
      .select({ tenantId: tenants.id, name: tenants.companyName, clientCode: tenants.clientCode, orgStatus: tenants.status, role: memberships.role, roleName: roles.name, status: memberships.status, joined: memberships.createdAt })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .leftJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(tenants.companyName)),
    db.select({ action: auditLog.action, at: auditLog.timestamp }).from(auditLog).where(eq(auditLog.userId, userId)).orderBy(desc(auditLog.timestamp)).limit(10),
  ]);
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      status: u.status,
      verified: Boolean(u.emailVerifiedAt),
      isPlatformAdmin: u.isPlatformAdmin,
      failedLoginCount: u.failedLoginCount,
      locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
      lockedUntil: u.lockedUntil?.toISOString() ?? null,
      lastLogin: u.lastLogin?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    },
    organizations: orgs.map((o) => ({ ...o, roleName: o.roleName ?? roleLabel(o.role), joined: o.joined.toISOString() })),
    events: events.map((e) => ({ action: e.action, at: e.at.toISOString() })),
  };
}

async function activePlatformAdmins() {
  const [{ n }] = await db.select({ n: count() }).from(users).where(and(eq(users.isPlatformAdmin, true), eq(users.status, "active")));
  return n;
}

/** Disables or re-enables an account everywhere. Disabling also signs the person out of every session at once. */
export async function setUserStatus(actorId: string, userId: string, status: "active" | "disabled"): Promise<Result> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return fail("Account not found.");
  if (u.id === actorId) return fail("You can't disable your own account.");
  if (u.status === status) return { ok: true };
  if (status === "disabled" && u.isPlatformAdmin && (await activePlatformAdmins()) <= 1) return fail("That is the only active platform administrator.");
  await db.update(users).set(status === "disabled" ? { status, sessionVersion: sql`${users.sessionVersion} + 1` } : { status }).where(eq(users.id, u.id));
  await logAuditEvent({ userId: actorId, action: status === "disabled" ? "platform_user_disabled" : "platform_user_enabled", entityType: "user", entityId: u.id, before: { status: u.status }, after: { status, email: u.email } });
  return { ok: true };
}

export async function unlockUser(actorId: string, userId: string): Promise<Result> {
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return fail("Account not found.");
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
  await logAuditEvent({ userId: actorId, action: "platform_user_unlocked", entityType: "user", entityId: u.id, after: { email: u.email } });
  return { ok: true };
}

/** Ends every session this person has: the next request from any of them is refused. */
export async function forceSignOut(actorId: string, userId: string): Promise<Result> {
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return fail("Account not found.");
  await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, u.id));
  await logAuditEvent({ userId: actorId, action: "platform_user_signed_out", entityType: "user", entityId: u.id, after: { email: u.email } });
  return { ok: true };
}

export async function setPlatformAdmin(actorId: string, userId: string, makeAdmin: boolean): Promise<Result> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return fail("Account not found.");
  if (u.isPlatformAdmin === makeAdmin) return { ok: true };
  if (makeAdmin && (!u.emailVerifiedAt || u.status !== "active")) return fail("Only an active account with a verified email can become a platform administrator.");
  if (!makeAdmin) {
    if (u.id === actorId) return fail("You can't remove your own platform administrator access.");
    if ((await activePlatformAdmins()) <= 1) return fail("There must always be at least one platform administrator.");
  }
  // The flag is read into the session when someone signs in, so a change here takes effect on their next sign-in; a
  // removal also ends their current sessions so it can't linger.
  await db.update(users).set(makeAdmin ? { isPlatformAdmin: true } : { isPlatformAdmin: false, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, u.id));
  await logAuditEvent({ userId: actorId, action: makeAdmin ? "platform_admin_granted" : "platform_admin_revoked", entityType: "user", entityId: u.id, after: { email: u.email } });
  return { ok: true };
}

// ------------------------------------------------------------------ organizations

export type OrgFilters = { search?: string; status?: string; page: number; pageSize: number };

export async function listPlatformOrgs(f: OrgFilters) {
  const conditions: (SQL | undefined)[] = [];
  const q = f.search?.trim();
  if (q) conditions.push(or(ilike(tenants.companyName, `%${q}%`), ilike(tenants.clientCode, `%${q}%`), ilike(tenants.panVatNumber, `%${q}%`)));
  if (f.status === "active" || f.status === "suspended" || f.status === "cancelled") conditions.push(eq(tenants.status, f.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const pageSize = Math.min(Math.max(f.pageSize, 1), 100);
  const page = Math.max(f.page, 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: tenants.id,
        clientCode: tenants.clientCode,
        name: tenants.companyName,
        pan: tenants.panVatNumber,
        status: tenants.status,
        createdAt: tenants.createdAt,
        plan: subscriptions.plan,
        planStatus: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        members: sql<number>`(select count(*)::int from memberships m where m.tenant_id = "tenants"."id")`,
        owner: sql<string | null>`(select u.name from memberships m join users u on u.id = m.user_id where m.tenant_id = "tenants"."id" and m.role = 'owner' order by m.created_at limit 1)`,
      })
      .from(tenants)
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .where(where)
      .orderBy(desc(tenants.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(tenants).where(where),
  ]);
  return { total, page, pageSize, rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), trialEndsAt: r.trialEndsAt?.toISOString() ?? null })) };
}

export async function getPlatformOrg(tenantId: string) {
  const [t] = await db
    .select({ tenant: tenants, plan: subscriptions.plan, planStatus: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt, periodEnd: subscriptions.currentPeriodEnd })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) return null;
  const [members, events] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, roleName: roles.name, status: memberships.status, joined: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(memberships.tenantId, tenantId))
      .orderBy(asc(memberships.createdAt)),
    db.select({ action: auditLog.action, at: auditLog.timestamp, after: auditLog.afterValue }).from(auditLog).where(and(eq(auditLog.entityType, "organization"), eq(auditLog.entityId, tenantId))).orderBy(desc(auditLog.timestamp)).limit(10),
  ]);
  const o = t.tenant;
  return {
    org: {
      id: o.id,
      clientCode: o.clientCode,
      name: o.companyName,
      industry: o.industry,
      country: o.country,
      address: o.address,
      phone: o.phone,
      email: o.email,
      pan: o.panVatNumber,
      status: o.status,
      calendar: o.calendarSystem,
      createdAt: o.createdAt.toISOString(),
      plan: t.plan,
      planStatus: t.planStatus,
      trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
      periodEnd: t.periodEnd?.toISOString() ?? null,
    },
    members: members.map((m) => ({ ...m, roleName: m.roleName ?? roleLabel(m.role), joined: m.joined.toISOString() })),
    events: events.map((e) => ({ action: e.action, at: e.at.toISOString(), reason: (e.after as { reason?: string } | null)?.reason ?? null })),
  };
}

/** Suspends or reactivates an organization. It takes effect for every member on their very next request. */
export async function setOrgStatus(actorId: string, tenantId: string, status: "active" | "suspended", reason: string): Promise<Result> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) return fail("Organization not found.");
  if (t.status === "cancelled") return fail("A cancelled organization can't be changed here.");
  if (t.status === status) return { ok: true };
  if (status === "suspended" && !reason.trim()) return fail("Enter the reason for suspending this organization.");
  await db.update(tenants).set({ status }).where(eq(tenants.id, t.id));
  await logAuditEvent({ tenantId: null, userId: actorId, action: status === "suspended" ? "organization_suspended" : "organization_reactivated", entityType: "organization", entityId: t.id, before: { status: t.status }, after: { status, reason: reason.trim() || undefined, name: t.companyName } });
  return { ok: true };
}

export async function platformCounts() {
  const [[u], [o]] = await Promise.all([
    db
      .select({
        total: count(),
        admins: sql<number>`count(*) filter (where ${users.isPlatformAdmin})::int`,
        unverified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is null)::int`,
        disabled: sql<number>`count(*) filter (where ${users.status} = 'disabled')::int`,
      })
      .from(users),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${tenants.status} = 'active')::int`,
        suspended: sql<number>`count(*) filter (where ${tenants.status} = 'suspended')::int`,
      })
      .from(tenants),
  ]);
  return { users: u, orgs: o };
}
