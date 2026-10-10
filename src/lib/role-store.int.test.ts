import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, roles } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { defaultPermissionsFor } from "./permissions";
import { createRole, deleteRole, ensureSystemRoles, listRoles, resetSystemRole, updateRole } from "./role-store";

let org: Awaited<ReturnType<typeof createTempOrg>>;

beforeAll(async () => {
  org = await createTempOrg("ZZ Roles");
});
afterAll(async () => {
  await org.remove();
});

const byName = async (name: string) => (await db.select().from(roles).where(and(eq(roles.tenantId, org.tenantId), eq(roles.name, name))))[0];

describe("standard roles", () => {
  it("are created once, numbered in order, and the existing member is linked to the right one", async () => {
    await ensureSystemRoles(org.tenantId);
    await ensureSystemRoles(org.tenantId); // idempotent
    const list = await listRoles(org.tenantId);
    expect(list.map((r) => [r.roleNumber, r.name, r.systemKey])).toEqual([
      [1, "Owner", "owner"],
      [2, "Administrator", "admin"],
      [3, "Accountant", "accountant"],
      [4, "Staff", "staff"],
    ]);
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, org.userId)));
    expect(m.roleId).toBe((await byName("Owner")).id);
    expect(list.find((r) => r.name === "Owner")!.members).toBe(1);
  });

  it("Owner and Administrator can't be changed; Accountant can, and can be reset", async () => {
    const owner = await byName("Owner");
    expect(await updateRole(org.tenantId, org.userId, owner.id, { name: "Owner", permissions: defaultPermissionsFor("staff") })).toMatchObject({ ok: false, error: expect.stringMatching(/full access/) });

    const accountant = await byName("Accountant");
    const trimmed = { ...defaultPermissionsFor("accountant"), sales: { view: true, create: true } };
    expect(await updateRole(org.tenantId, org.userId, accountant.id, { name: "Renamed", description: "x", permissions: trimmed })).toMatchObject({ ok: true });
    const after = await byName("Accountant"); // the name of a standard role is not editable
    expect(after.permissions.sales).toEqual({ view: true, create: true, edit: false, void: false, delete: false });

    expect(await resetSystemRole(org.tenantId, org.userId, accountant.id)).toMatchObject({ ok: true });
    expect((await byName("Accountant")).permissions.sales).toEqual(defaultPermissionsFor("accountant").sales);
  });
});

describe("custom roles", () => {
  it("are created with normalized permissions, a number, and a unique name", async () => {
    const r = await createRole(org.tenantId, org.userId, { name: "  Cashier  ", description: "Counter staff", permissions: { sales: { void: true }, payments: { view: true, create: true } } });
    expect(r.ok).toBe(true);
    const cashier = await byName("Cashier");
    expect(cashier).toMatchObject({ roleNumber: 5, baseRole: "staff", systemKey: null, isActive: true });
    expect(cashier.permissions.sales).toEqual({ view: true, create: false, edit: false, void: true, delete: false }); // void brought View with it
    expect(cashier.permissions.payroll).toEqual({ view: false, create: false, edit: false, delete: false, view_salary: false });

    expect(await createRole(org.tenantId, org.userId, { name: "CASHIER", permissions: { sales: { view: true } } })).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(await createRole(org.tenantId, org.userId, { name: " ", permissions: { sales: { view: true } } })).toMatchObject({ ok: false, error: expect.stringMatching(/role name/) });
    expect(await createRole(org.tenantId, org.userId, { name: "Nothing", permissions: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/at least one permission/) });
  });

  it("can be edited and renamed, but not into another role's name", async () => {
    const cashier = await byName("Cashier");
    expect(await updateRole(org.tenantId, org.userId, cashier.id, { name: "Till operator", permissions: { sales: { view: true } }, isActive: false })).toMatchObject({ ok: true });
    expect(await byName("Till operator")).toMatchObject({ isActive: false });
    expect(await updateRole(org.tenantId, org.userId, cashier.id, { name: "staff", permissions: { sales: { view: true } } })).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
  });

  it("can't be deleted while someone has it, and standard roles can't be deleted at all", async () => {
    const role = await byName("Till operator");
    await db.update(memberships).set({ roleId: role.id }).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, org.userId)));
    expect(await deleteRole(org.tenantId, org.userId, role.id)).toMatchObject({ ok: false, error: expect.stringMatching(/1 user has this role/) });
    await db.update(memberships).set({ roleId: (await byName("Owner")).id }).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, org.userId)));
    expect(await deleteRole(org.tenantId, org.userId, role.id)).toEqual({ ok: true });
    expect(await deleteRole(org.tenantId, org.userId, (await byName("Staff")).id)).toMatchObject({ ok: false, error: expect.stringMatching(/standard role/) });
  });
});
