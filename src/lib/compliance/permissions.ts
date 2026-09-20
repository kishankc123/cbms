import { requireUserSession } from "@/lib/session";

/**
 * Who may change compliance CONFIGURATION (countries, entity types, tax types,
 * requirement templates, applicability and due-date rules).
 *
 * Today that is platform admins. It is one function on purpose: moving this
 * power to a separate super-admin tier later means changing this check (and
 * adding the flag it reads), not hunting through every action.
 */
export function canManageComplianceConfig(user: { isPlatformAdmin: boolean }): boolean {
  return user.isPlatformAdmin;
}

export async function requireComplianceConfigAdmin() {
  const user = await requireUserSession();
  if (!canManageComplianceConfig(user)) throw new Error("Only a platform administrator can change compliance configuration");
  return user;
}
