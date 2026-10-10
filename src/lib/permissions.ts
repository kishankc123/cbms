// The single list of what can be allowed or denied, module by module. The role screen draws its permission matrix from
// this list, and `can(session, module, action)` checks against it, so a module or action that is enforced somewhere in the
// code is exactly one that appears here (and nothing appears here that no check enforces).

export type PermissionAction = "view" | "create" | "edit" | "void" | "delete";
/**
 * A special permission inside a module, beyond the five actions: something more sensitive than the module as a whole that a role may
 * be given or kept back (for example seeing what people are paid). It sits in the same permission record under its own key, and a
 * role saved before it existed follows the module's View, so nobody loses access when one is added.
 */
export type ExtraPermission = "view_salary";
export const PERMISSION_ACTIONS: PermissionAction[] = ["view", "create", "edit", "void", "delete"];
export const ACTION_LABEL: Record<PermissionAction, string> = { view: "View", create: "Create", edit: "Edit", void: "Void", delete: "Delete" };

export type PermissionModule = {
  key: string;
  label: string;
  description: string;
  actions: PermissionAction[];
  /** What an action means in this module, where "Void" and "Delete" need saying. */
  help?: Partial<Record<PermissionAction, string>>;
  /** Special permissions of this module, shown under its name in the role screen. Each needs View. */
  extras?: { key: ExtraPermission; label: string; help: string; /** Whether the standard Staff role starts with it. */ staffDefault: boolean }[];
};

export const PERMISSION_CATALOG: PermissionModule[] = [
  { key: "sales", label: "Sales & Customers", description: "Invoices, sales returns and customers", actions: ["view", "create", "edit", "void", "delete"], help: { void: "Void invoices and sales returns", delete: "Delete customers" } },
  { key: "purchases", label: "Purchases & Suppliers", description: "Bills, purchase returns and suppliers", actions: ["view", "create", "edit", "void", "delete"], help: { void: "Void bills and purchase returns", delete: "Delete suppliers" } },
  { key: "expenses", label: "Expenses", description: "One-off and recurring expenses", actions: ["view", "create", "edit", "void"], help: { void: "Void expenses" } },
  { key: "payments", label: "Payments", description: "Money in, money out and transfers", actions: ["view", "create", "edit", "void"], help: { void: "Void payments and transfers" } },
  { key: "inventory", label: "Inventory", description: "Products, services and stock", actions: ["view", "create", "edit", "delete"], help: { delete: "Delete items, units, groups, categories and opening stock" } },
  { key: "assets", label: "Assets", description: "Fixed assets, depreciation, sales and write-offs", actions: ["view", "create", "edit", "void"], help: { edit: "Also runs monthly depreciation and records sales and write-offs", void: "Void purchases and opening assets; reverse depreciation runs and disposals" } },
  {
    key: "payroll",
    label: "Payroll",
    description: "Employees, attendance and salary sheets",
    actions: ["view", "create", "edit", "delete"],
    help: { delete: "Delete salary components" },
    extras: [{ key: "view_salary", label: "See salary amounts", help: "See and change what people are paid: salaries, salary sheets, salary components and the payroll reports", staffDefault: false }],
  },
  { key: "bank_reconciliation", label: "Bank Reconciliation", description: "Bank accounts and reconciliations", actions: ["view", "create", "edit"] },
  { key: "chart_of_accounts", label: "Chart of Accounts & Journal", description: "Accounts, manual journal entries and ledger reports", actions: ["view", "create", "edit", "void", "delete"], help: { void: "Reverse journal entries", delete: "Delete accounts" } },
  { key: "compliance", label: "Compliance", description: "Tax, statutory items, calendar and penalties", actions: ["view", "create", "edit", "void", "delete"], help: { void: "Void tax charges", delete: "Delete calendar and statutory items" } },
  { key: "audit", label: "Audit", description: "Audit rules, exceptions and period locking", actions: ["view", "create", "edit", "delete"], help: { delete: "Delete audit rules" } },
  { key: "settings", label: "Settings", description: "Company details, numbering and fiscal years", actions: ["view", "edit"] },
];

export type Permissions = Record<string, Partial<Record<PermissionAction | ExtraPermission, boolean>>>;

const moduleDef = (key: string) => PERMISSION_CATALOG.find((m) => m.key === key);

/** Every catalog action as an explicit true/false; anything unknown is dropped, and any other action implies View. */
export function normalizePermissions(raw: Permissions | null | undefined): Permissions {
  const out: Permissions = {};
  for (const m of PERMISSION_CATALOG) {
    const have = raw?.[m.key] ?? {};
    const row: Partial<Record<PermissionAction | ExtraPermission, boolean>> = {};
    for (const a of m.actions) row[a] = Boolean(have[a]);
    // A special permission that was never recorded follows the module's View, so a role saved before it existed keeps what it had.
    for (const e of m.extras ?? []) row[e.key] = have[e.key] === undefined ? Boolean(have.view) : Boolean(have[e.key]);
    if (m.actions.some((a) => a !== "view" && row[a]) || (m.extras ?? []).some((e) => row[e.key])) row.view = true;
    out[m.key] = row;
  }
  return out;
}

export function fullAccessPermissions(): Permissions {
  const out: Permissions = {};
  for (const m of PERMISSION_CATALOG) out[m.key] = Object.fromEntries([...m.actions, ...(m.extras ?? []).map((e) => e.key)].map((a) => [a, true]));
  return out;
}

const ENTRY_MODULES = ["sales", "purchases", "expenses", "payments", "inventory"];

/** What each standard role starts with (and what "Reset to default" restores). Owner and Administrator bypass checks anyway. */
export function defaultPermissionsFor(role: "owner" | "admin" | "accountant" | "staff"): Permissions {
  const out: Permissions = {};
  for (const m of PERMISSION_CATALOG) {
    const row: Partial<Record<PermissionAction | ExtraPermission, boolean>> = {};
    for (const e of m.extras ?? []) row[e.key] = role === "staff" ? e.staffDefault : true;
    for (const a of m.actions) {
      if (role === "owner" || role === "admin") row[a] = true;
      else if (role === "accountant") row[a] = m.key === "settings" ? a === "view" : true;
      else if (ENTRY_MODULES.includes(m.key)) row[a] = a === "view" || a === "create" || a === "edit";
      else row[a] = m.key === "chart_of_accounts" && a === "view";
    }
    out[m.key] = row;
  }
  return out;
}

/** The check behind can(): Owner and Administrator always pass; everyone else needs the action ticked on their role. */
export function hasPermission(role: string, permissions: Permissions, module: string, action: PermissionAction | ExtraPermission): boolean {
  if (role === "owner" || role === "admin") return true;
  const row = permissions[module];
  // A special permission a role never recorded follows the module's View.
  if (row?.[action] === undefined && moduleDef(module)?.extras?.some((e) => e.key === action)) return Boolean(row?.view);
  return Boolean(row?.[action]);
}

export const isKnownAction = (module: string, action: PermissionAction | ExtraPermission) => Boolean(moduleDef(module)?.actions.includes(action as PermissionAction) || moduleDef(module)?.extras?.some((e) => e.key === action));

/** A plain-language count for the role list, e.g. "9 of 12 modules". */
export function accessSummary(p: Permissions): string {
  const withAccess = PERMISSION_CATALOG.filter((m) => m.actions.some((a) => p[m.key]?.[a])).length;
  return `${withAccess} of ${PERMISSION_CATALOG.length} modules`;
}
