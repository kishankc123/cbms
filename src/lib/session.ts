import { auth } from "@/lib/auth";
import type { Permissions } from "@/db/schema/tenancy";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class TenantScopeError extends Error {
  constructor() {
    super("No tenant scope on session");
  }
}

export type AppSession = {
  userId: string;
  tenantId: string;
  role: "super_admin" | "admin" | "user";
  permissions: Permissions;
};

/**
 * Every server action / route handler that touches tenant data must call this
 * instead of reading the raw NextAuth session. It fails closed: no session, no
 * tenantId, or a super_admin outside of an explicit impersonation context all
 * throw rather than silently returning data for the wrong (or no) tenant.
 */
export async function requireTenantSession(): Promise<AppSession> {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  if (!session.user.tenantId) throw new TenantScopeError();

  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    role: session.user.role,
    permissions: session.user.permissions,
  };
}

export function can(
  session: AppSession,
  module: string,
  action: "view" | "create" | "edit" | "delete"
): boolean {
  if (session.role === "admin") return true;
  return Boolean(session.permissions[module]?.[action]);
}
