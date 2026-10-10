import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG, accessSummary, defaultPermissionsFor, fullAccessPermissions, hasPermission, normalizePermissions, type Permissions } from "./permissions";

const can = (s: { role: string; permissions: Permissions }, module: string, action: "view" | "create" | "edit" | "void" | "delete") => hasPermission(s.role, s.permissions, module, action);
const session = (role: string, permissions: Permissions) => ({ role, permissions });

describe("permission catalog", () => {
  it("lists every module once, each with View", () => {
    const keys = PERMISSION_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of PERMISSION_CATALOG) expect(m.actions).toContain("view");
  });

  it("covers the modules the app checks", () => {
    expect(PERMISSION_CATALOG.map((m) => m.key).sort()).toEqual(["assets", "audit", "bank_reconciliation", "chart_of_accounts", "compliance", "expenses", "inventory", "payments", "payroll", "purchases", "sales", "settings"]);
  });
});

describe("normalizing permissions", () => {
  it("fills every action explicitly and drops unknown ones", () => {
    const p = normalizePermissions({ sales: { view: true, create: true, nonsense: true } as never, ghost: { view: true } });
    expect(p.sales).toEqual({ view: true, create: true, edit: false, void: false, delete: false });
    expect(p.ghost).toBeUndefined();
    expect(p.settings).toEqual({ view: false, edit: false });
  });

  it("an action implies View", () => {
    expect(normalizePermissions({ sales: { void: true } }).sales.view).toBe(true);
  });
});

describe("standard roles", () => {
  it("Accountant can do everything except change settings", () => {
    const p = defaultPermissionsFor("accountant");
    expect(p.sales).toEqual({ view: true, create: true, edit: true, void: true, delete: true });
    expect(p.settings).toEqual({ view: true, edit: false });
  });

  it("Staff enters day-to-day work but can't void or delete, and sees nothing sensitive", () => {
    const p = defaultPermissionsFor("staff");
    expect(p.sales).toEqual({ view: true, create: true, edit: true, void: false, delete: false });
    expect(p.chart_of_accounts.view).toBe(true);
    expect(p.chart_of_accounts.create).toBe(false);
    expect(p.payroll.view).toBe(false);
    expect(p.settings.view).toBe(false);
  });

  it("a summary counts the modules with any access", () => {
    expect(accessSummary(defaultPermissionsFor("staff"))).toBe("6 of 12 modules");
    expect(accessSummary(fullAccessPermissions())).toBe("12 of 12 modules");
  });
});

describe("can()", () => {
  it("Owner and Administrator bypass the checks", () => {
    expect(can(session("owner", {}), "payroll", "void")).toBe(true);
    expect(can(session("admin", {}), "sales", "delete")).toBe(true);
  });

  it("everyone else follows their role's permissions, with anything not listed denied", () => {
    const custom = session("staff", { sales: { view: true, create: true } });
    expect(can(custom, "sales", "create")).toBe(true);
    expect(can(custom, "sales", "void")).toBe(false);
    expect(can(custom, "payroll", "view")).toBe(false);
  });
});

describe("special permissions (See salary amounts)", () => {
  it("sit under their module in the catalog", () => {
    expect(PERMISSION_CATALOG.find((m) => m.key === "payroll")?.extras?.map((e) => e.key)).toEqual(["view_salary"]);
  });

  it("a role saved before it existed keeps what it had: it follows the module's View", () => {
    expect(normalizePermissions({ payroll: { view: true, create: true } }).payroll).toMatchObject({ view: true, view_salary: true });
    expect(normalizePermissions({ payroll: {} }).payroll).toMatchObject({ view: false, view_salary: false });
    // and without being normalized at all
    expect(hasPermission("staff", { payroll: { view: true } }, "payroll", "view_salary")).toBe(true);
    expect(hasPermission("staff", { payroll: {} }, "payroll", "view_salary")).toBe(false);
  });

  it("can be switched off on its own, and switching it on brings View with it", () => {
    expect(normalizePermissions({ payroll: { view: true, view_salary: false } }).payroll).toMatchObject({ view: true, view_salary: false });
    expect(hasPermission("staff", { payroll: { view: true, view_salary: false } }, "payroll", "view_salary")).toBe(false);
    expect(normalizePermissions({ payroll: { view_salary: true } }).payroll.view).toBe(true);
  });

  it("is on for the standard Accountant and Administrator, off for Staff, and Owner bypasses it", () => {
    expect(defaultPermissionsFor("accountant").payroll.view_salary).toBe(true);
    expect(defaultPermissionsFor("admin").payroll.view_salary).toBe(true);
    expect(defaultPermissionsFor("staff").payroll.view_salary).toBe(false);
    expect(fullAccessPermissions().payroll.view_salary).toBe(true);
    expect(hasPermission("owner", {}, "payroll", "view_salary")).toBe(true);
  });
});
