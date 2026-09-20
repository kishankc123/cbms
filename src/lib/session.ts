import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { memberships, tenants, users } from "@/db/schema";
import type { Permissions } from "@/db/schema/tenancy";
import { effectivePermissions, type OrgRole } from "@/lib/roles";
import { isSessionExpired } from "@/lib/session-expiry";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class TenantScopeError extends Error {
  constructor() {
    super("No active organization on session");
  }
}

export type AppSession = {
  userId: string;
  tenantId: string;
  role: OrgRole;
  permissions: Permissions;
};

/**
 * Signed-in user without any organization context — for pages like the
 * organization picker. Still re-validates the user against the database, so a
 * disabled account or a password reset takes effect immediately.
 */
export const requireUserSession = cache(async () => {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  if (isSessionExpired(session.user.remember, session.user.loginAt)) throw new UnauthorizedError();

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, sessionVersion: users.sessionVersion, emailVerifiedAt: users.emailVerifiedAt, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user || user.status !== "active" || user.sessionVersion !== session.user.sessionVersion) throw new UnauthorizedError();

  return { ...user, activeTenantId: session.user.activeTenantId };
});

/**
 * Every server action / route handler that touches organization data must call
 * this. The active organization comes from the signed session, but the role and
 * permissions are NOT trusted from it: the user's membership in that
 * organization is loaded from the database on every request, so removing a
 * member, changing their role, suspending the organization or resetting a
 * password all take effect immediately. It fails closed.
 */
export const requireTenantSession = cache(async (): Promise<AppSession> => {
  const user = await requireUserSession();
  if (!user.activeTenantId) throw new TenantScopeError();

  const [row] = await db
    .select({ role: memberships.role, permissions: memberships.permissions })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.tenantId, user.activeTenantId),
        eq(memberships.status, "active"),
        eq(tenants.status, "active")
      )
    )
    .limit(1);
  if (!row) throw new TenantScopeError();

  return {
    userId: user.id,
    tenantId: user.activeTenantId,
    role: row.role,
    permissions: effectivePermissions(row.role, row.permissions),
  };
});

export function can(session: AppSession, module: string, action: "view" | "create" | "edit" | "delete"): boolean {
  if (session.role === "owner" || session.role === "admin") return true;
  return Boolean(session.permissions[module]?.[action]);
}
