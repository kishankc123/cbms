"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, type AppSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { PERMISSION_CATALOG, accessSummary, defaultPermissionsFor, fullAccessPermissions, normalizePermissions, type Permissions } from "@/lib/permissions";
import { createRole, deleteRole, getRole, isFixedRole, listRoles, resetSystemRole, updateRole, type RoleInput } from "@/lib/role-store";

async function requireOrgAdmin(): Promise<AppSession> {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an Owner or Administrator can manage roles.");
  return session;
}

export async function getRolesList() {
  const session = await requireOrgAdmin();
  const rows = await listRoles(session.tenantId);
  return rows.map((r) => ({
    id: r.id,
    code: `ROLE-${String(r.roleNumber).padStart(3, "0")}`,
    name: r.name,
    description: r.description ?? "",
    isSystem: Boolean(r.systemKey),
    fixed: isFixedRole(r),
    isActive: r.isActive,
    members: r.members,
    access: isFixedRole(r) ? "Full access" : accessSummary(r.permissions),
  }));
}
export type RolesList = Awaited<ReturnType<typeof getRolesList>>;

/** What the role form starts from: an existing role, a copy of one, or nothing. */
export async function getRoleEditor(roleId: string | null, copyFromId?: string | null) {
  const session = await requireOrgAdmin();
  const all = await listRoles(session.tenantId);
  const role = roleId ? await getRole(session.tenantId, roleId) : null;
  if (roleId && !role) return null;
  const source = role ?? (copyFromId ? all.find((r) => r.id === copyFromId) ?? null : null);

  return {
    catalog: PERMISSION_CATALOG,
    role: role
      ? {
          id: role.id,
          code: `ROLE-${String(role.roleNumber).padStart(3, "0")}`,
          name: role.name,
          description: role.description ?? "",
          isActive: role.isActive,
          isSystem: Boolean(role.systemKey),
          fixed: isFixedRole(role),
          members: all.find((r) => r.id === role.id)?.members ?? 0,
        }
      : null,
    initial: {
      name: role ? role.name : source ? `${source.name} (copy)` : "",
      description: role ? role.description ?? "" : source?.description ?? "",
      permissions: role && isFixedRole(role) ? fullAccessPermissions() : normalizePermissions(source?.permissions),
    },
    copyOptions: all.map((r) => ({ id: r.id, name: r.name, permissions: isFixedRole(r) ? fullAccessPermissions() : normalizePermissions(r.permissions) })),
    defaults: role?.systemKey && !isFixedRole(role) ? defaultPermissionsFor(role.systemKey as "accountant" | "staff") : null,
  };
}
export type RoleEditor = NonNullable<Awaited<ReturnType<typeof getRoleEditor>>>;

export async function saveRole(roleId: string | null, input: RoleInput) {
  const session = await requireOrgAdmin();
  const result = roleId ? await updateRole(session.tenantId, session.userId, roleId, input) : await createRole(session.tenantId, session.userId, input);
  if (result.ok) revalidatePath("/settings", "layout");
  return result;
}

export async function removeRole(roleId: string) {
  const session = await requireOrgAdmin();
  const result = await deleteRole(session.tenantId, session.userId, roleId);
  if (result.ok) revalidatePath("/settings", "layout");
  return result;
}

export async function resetRole(roleId: string) {
  const session = await requireOrgAdmin();
  const result = await resetSystemRole(session.tenantId, session.userId, roleId);
  if (result.ok) revalidatePath("/settings", "layout");
  return result;
}

export type { Permissions };
