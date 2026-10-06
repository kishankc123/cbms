import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invitations, memberships, roles } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { defaultPermissionsFor, normalizePermissions, type Permissions } from "@/lib/permissions";
import { ORG_ROLES, type OrgRole } from "@/lib/roles";

// Roles are kept per organization. The four standard ones (Owner, Administrator, Accountant, Staff) exist everywhere and
// are created on first use; custom roles are added on top. Plain server helpers, deliberately not server actions.

export type RoleRow = typeof roles.$inferSelect;
export type RoleResult = { ok: true; roleId: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

const SYSTEM_ORDER: OrgRole[] = ["owner", "admin", "accountant", "staff"];
/** Owner and Administrator always have full access; Accountant and Staff can be adjusted. */
export const isFixedRole = (r: Pick<RoleRow, "systemKey">) => r.systemKey === "owner" || r.systemKey === "admin";

/** Makes sure the standard roles exist and every member is linked to one. Safe to call any number of times. */
export async function ensureSystemRoles(tenantId: string): Promise<Map<OrgRole, string>> {
  let existing = await db.select().from(roles).where(and(eq(roles.tenantId, tenantId), sql`${roles.systemKey} is not null`));
  const have = new Set(existing.map((r) => r.systemKey));
  const missing = SYSTEM_ORDER.filter((k) => !have.has(k));
  if (missing.length > 0) {
    for (const key of missing) {
      const def = ORG_ROLES.find((r) => r.value === key)!;
      for (let attempt = 0; attempt < 4; attempt++) {
        const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${roles.roleNumber}), 0)::int` }).from(roles).where(eq(roles.tenantId, tenantId));
        try {
          await db.insert(roles).values({ tenantId, roleNumber: n + 1, name: def.label, description: def.description, systemKey: key, baseRole: key, permissions: defaultPermissionsFor(key) });
          break;
        } catch (e) {
          // Another request created it (or took the number) first.
          if (!isUniqueViolation(e)) throw e;
          if ((await db.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.systemKey, key))).limit(1)).length > 0) break;
        }
      }
    }
    existing = await db.select().from(roles).where(and(eq(roles.tenantId, tenantId), sql`${roles.systemKey} is not null`));
  }
  const byKey = new Map(existing.map((r) => [r.systemKey as OrgRole, r.id]));

  // Members (and pending invitations) that predate roles get the standard role matching their level.
  for (const [key, id] of byKey) {
    await db.update(memberships).set({ roleId: id }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, key), isNull(memberships.roleId)));
    await db.update(invitations).set({ roleId: id }).where(and(eq(invitations.tenantId, tenantId), eq(invitations.role, key), isNull(invitations.roleId)));
  }
  return byKey;
}

export async function listRoles(tenantId: string) {
  await ensureSystemRoles(tenantId);
  const rows = await db
    .select({
      role: roles,
      members: sql<number>`(select count(*)::int from memberships m where m.role_id = "roles"."id")`,
    })
    .from(roles)
    .where(eq(roles.tenantId, tenantId))
    .orderBy(asc(roles.roleNumber));
  return rows.map((r) => ({ ...r.role, members: r.members }));
}

export async function getRole(tenantId: string, roleId: string): Promise<RoleRow | null> {
  const [row] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))).limit(1);
  return row ?? null;
}

export type RoleInput = { name: string; description?: string; permissions: Permissions; isActive?: boolean };

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return { error: "Enter the role name." };
  if (n.length > 60) return { error: "The role name can't be longer than 60 characters." };
  return { name: n };
}

export async function createRole(tenantId: string, userId: string, input: RoleInput): Promise<RoleResult> {
  const named = cleanName(input.name);
  if (!named.name) return fail(named.error ?? "Enter the role name.");
  await ensureSystemRoles(tenantId);
  const permissions = normalizePermissions(input.permissions);
  if (!Object.values(permissions).some((m) => Object.values(m).some(Boolean))) return fail("Allow at least one permission, or the role can't do anything.");

  for (let attempt = 0; attempt < 4; attempt++) {
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${roles.roleNumber}), 0)::int` }).from(roles).where(eq(roles.tenantId, tenantId));
    try {
      const [row] = await db
        .insert(roles)
        .values({ tenantId, roleNumber: n + 1, name: named.name, description: input.description?.trim() || null, baseRole: "staff", permissions, isActive: input.isActive ?? true, createdBy: userId })
        .returning();
      await logAuditEvent({ tenantId, userId, action: "role_created", entityType: "role", entityId: row.id, after: { name: row.name, permissions } });
      return { ok: true, roleId: row.id };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const [clash] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), sql`lower(${roles.name}) = lower(${named.name})`)).limit(1);
      if (clash) return fail(`A role named "${named.name}" already exists.`);
    }
  }
  return fail("Could not save the role; please try again.");
}

export async function updateRole(tenantId: string, userId: string, roleId: string, input: RoleInput): Promise<RoleResult> {
  const role = await getRole(tenantId, roleId);
  if (!role) return fail("Role not found.");
  if (isFixedRole(role)) return fail(`${role.name} always has full access and can't be changed.`);

  const permissions = normalizePermissions(input.permissions);
  if (!Object.values(permissions).some((m) => Object.values(m).some(Boolean))) return fail("Allow at least one permission, or the role can't do anything.");
  let name = role.name;
  if (!role.systemKey) {
    const named = cleanName(input.name);
    if (!named.name) return fail(named.error ?? "Enter the role name.");
    name = named.name;
  }
  try {
    await db
      .update(roles)
      .set({ name, description: input.description?.trim() || null, permissions, isActive: role.systemKey ? true : input.isActive ?? role.isActive, updatedAt: new Date() })
      .where(eq(roles.id, role.id));
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`A role named "${name}" already exists.`);
    throw e;
  }
  await logAuditEvent({ tenantId, userId, action: "role_updated", entityType: "role", entityId: role.id, before: { name: role.name, permissions: role.permissions, isActive: role.isActive }, after: { name, permissions, isActive: input.isActive ?? role.isActive } });
  return { ok: true, roleId: role.id };
}

/** Puts a standard role back to what it started with. */
export async function resetSystemRole(tenantId: string, userId: string, roleId: string): Promise<RoleResult> {
  const role = await getRole(tenantId, roleId);
  if (!role || !role.systemKey) return fail("Only a standard role can be reset.");
  if (isFixedRole(role)) return fail(`${role.name} always has full access.`);
  const permissions = defaultPermissionsFor(role.systemKey as OrgRole);
  await db.update(roles).set({ permissions, updatedAt: new Date() }).where(eq(roles.id, role.id));
  await logAuditEvent({ tenantId, userId, action: "role_reset", entityType: "role", entityId: role.id, before: { permissions: role.permissions }, after: { permissions } });
  return { ok: true, roleId: role.id };
}

export async function deleteRole(tenantId: string, userId: string, roleId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getRole(tenantId, roleId);
  if (!role) return fail("Role not found.");
  if (role.systemKey) return fail("A standard role can't be deleted.");
  const [{ members, invited }] = await db
    .select({
      members: sql<number>`(select count(*)::int from memberships m where m.role_id = ${role.id})`,
      invited: sql<number>`(select count(*)::int from invitations i where i.role_id = ${role.id} and i.status = 'pending')`,
    })
    .from(roles)
    .where(eq(roles.id, role.id));
  if (members > 0) return fail(`${members} user${members === 1 ? " has" : "s have"} this role. Give ${members === 1 ? "them" : "those users"} another role first.`);
  if (invited > 0) return fail("A pending invitation uses this role. Revoke it first.");
  await db.update(invitations).set({ roleId: null }).where(eq(invitations.roleId, role.id));
  await db.delete(roles).where(eq(roles.id, role.id));
  await logAuditEvent({ tenantId, userId, action: "role_deleted", entityType: "role", entityId: role.id, before: { name: role.name, permissions: role.permissions } });
  return { ok: true };
}
