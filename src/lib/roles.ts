import type { Permissions } from "@/db/schema/tenancy";

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

const MODULES = [
  "bank_reconciliation",
  "chart_of_accounts",
  "compliance",
  "expenses",
  "inventory",
  "payments",
  "payroll",
  "purchases",
  "sales",
  "settings",
] as const;

const all = (view: boolean, create: boolean, edit: boolean, del: boolean) => ({ view, create, edit, delete: del });

// Default permissions per role, used unless a membership carries its own
// override. Owner/Administrator never reach this (they bypass checks).
export function defaultPermissions(role: OrgRole): Permissions {
  const perms: Permissions = {};
  for (const m of MODULES) {
    if (role === "accountant") perms[m] = m === "settings" ? all(true, false, false, false) : all(true, true, true, true);
    else if (role === "staff") {
      const entry = ["sales", "purchases", "expenses", "payments", "inventory"].includes(m);
      perms[m] = entry ? all(true, true, true, false) : m === "chart_of_accounts" ? all(true, false, false, false) : all(false, false, false, false);
    } else perms[m] = all(true, true, true, true);
  }
  return perms;
}

export function effectivePermissions(role: OrgRole, override: Permissions | null | undefined): Permissions {
  return override && Object.keys(override).length > 0 ? override : defaultPermissions(role);
}
