import { defaultPermissionsFor, type Permissions } from "@/lib/permissions";

export type OrgRole = "owner" | "admin" | "accountant" | "staff";

export const ORG_ROLES: { value: OrgRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Full control, including users and the organization itself" },
  { value: "admin", label: "Administrator", description: "Manages users, settings and all accounting" },
  { value: "accountant", label: "Accountant", description: "Full accounting access, no user or settings management" },
  { value: "staff", label: "Staff", description: "Day-to-day entry (sales, purchases, expenses, payments)" },
];

export const roleLabel = (role: OrgRole) => ORG_ROLES.find((r) => r.value === role)?.label ?? role;

// Owner and Administrator manage the organization (users, settings, reopening
// locked periods) and bypass per-module permission checks.
export const isOrgAdmin = (role: OrgRole) => role === "owner" || role === "admin";

// Default permissions per standard role, used until the member is linked to a role record (see lib/role-store.ts).
// Owner/Administrator never reach this (they bypass checks).
export function defaultPermissions(role: OrgRole): Permissions {
  return defaultPermissionsFor(role);
}

export function effectivePermissions(role: OrgRole, override: Permissions | null | undefined): Permissions {
  return override && Object.keys(override).length > 0 ? override : defaultPermissions(role);
}
