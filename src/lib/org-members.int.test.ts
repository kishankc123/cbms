import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, memberships, roles, users } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { ensureSystemRoles } from "./role-store";
import { addExistingAccount, assignMemberNumbers, dismissAddNotice, leaveOrganization, listAddNotices, listMembersPage, lookupAccount, memberCode } from "./org-members";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const stamp = Date.now();
const verifiedEmail = `zz-members-verified-${stamp}@example.com`;
const unverifiedEmail = `zz-members-unverified-${stamp}@example.com`;
let verifiedId: string;
let unverifiedId: string;
const adder = { userId: "", name: "Admin Person" };

const role = async (key: "owner" | "accountant" | "staff") => (await db.select().from(roles).where(and(eq(roles.tenantId, org.tenantId), eq(roles.systemKey, key))))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Members");
  adder.userId = org.userId;
  await ensureSystemRoles(org.tenantId);
  const made = await db
    .insert(users)
    .values([
      { name: "Verified Vera", email: verifiedEmail, passwordHash: "x", emailVerifiedAt: new Date() },
      { name: "Unverified Uma", email: unverifiedEmail, passwordHash: "x" },
    ])
    .returning({ id: users.id, email: users.email });
  verifiedId = made.find((u) => u.email === verifiedEmail)!.id;
  unverifiedId = made.find((u) => u.email === unverifiedEmail)!.id;
});
afterAll(async () => {
  await org.remove();
  const ids = [verifiedId, unverifiedId].filter(Boolean);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
});

describe("finding an account to add", () => {
  it("only a verified account is offered; an unverified one looks like no account at all", async () => {
    expect(await lookupAccount(org.tenantId, "not-an-email")).toEqual({ state: "invalid" });
    expect(await lookupAccount(org.tenantId, `zz-nobody-${stamp}@example.com`)).toEqual({ state: "none" });
    expect(await lookupAccount(org.tenantId, unverifiedEmail)).toEqual({ state: "none" });
    expect(await lookupAccount(org.tenantId, `  ${verifiedEmail.toUpperCase()} `)).toEqual({ state: "found", name: "Verified Vera" });
  });
});

describe("adding an existing account", () => {
  it("gives access at once with the chosen role and status, records who added them, and leaves a notice", async () => {
    const accountant = await role("accountant");
    const r = await addExistingAccount(org.tenantId, adder, { email: verifiedEmail, role: accountant, status: "active" });
    expect(r).toEqual({ ok: true, name: "Verified Vera" });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, verifiedId)));
    expect(m).toMatchObject({ role: "accountant", roleId: accountant.id, status: "active", addedBy: org.userId, noticeDismissedAt: null });
    expect(m.memberNumber).not.toBeNull();

    const notices = await listAddNotices(verifiedId);
    expect(notices).toEqual([expect.objectContaining({ orgName: expect.stringContaining("ZZ Members"), roleName: "Accountant", addedByName: expect.any(String) })]);
    expect(await lookupAccount(org.tenantId, verifiedEmail)).toMatchObject({ state: "member", roleName: "Accountant" });
  });

  it("refuses someone already in the organization, an unverified account, and an unknown email", async () => {
    const staff = await role("staff");
    expect(await addExistingAccount(org.tenantId, adder, { email: verifiedEmail, role: staff, status: "active" })).toMatchObject({ ok: false, error: expect.stringMatching(/already belongs/) });
    expect(await addExistingAccount(org.tenantId, adder, { email: unverifiedEmail, role: staff, status: "active" })).toMatchObject({ ok: false, error: expect.stringMatching(/No verified account/) });
    expect(await addExistingAccount(org.tenantId, adder, { email: `zz-nobody-${stamp}@example.com`, role: staff, status: "active" })).toMatchObject({ ok: false });
  });

  it("can add someone as suspended, so they have no access until reactivated", async () => {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, unverifiedId)); // they verified in the meantime
    const staff = await role("staff");
    expect(await addExistingAccount(org.tenantId, adder, { email: unverifiedEmail, role: staff, status: "suspended" })).toMatchObject({ ok: true });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, unverifiedId)));
    expect(m.status).toBe("suspended");
  });
});

describe("member IDs and the list", () => {
  it("numbers everyone in order of joining, once, and the list searches by name, email or ID", async () => {
    await assignMemberNumbers(org.tenantId);
    await assignMemberNumbers(org.tenantId);
    const all = await listMembersPage(org.tenantId, { page: 1, pageSize: 25 });
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.code)).toEqual(["USR-0001", "USR-0002", "USR-0003"]);
    expect(memberCode(null)).toBe("—");

    expect((await listMembersPage(org.tenantId, { page: 1, pageSize: 25, search: "vera" })).rows.map((r) => r.name)).toEqual(["Verified Vera"]);
    expect((await listMembersPage(org.tenantId, { page: 1, pageSize: 25, search: "usr-3" })).total).toBe(1);
    expect((await listMembersPage(org.tenantId, { page: 1, pageSize: 25, status: "suspended" })).rows.map((r) => r.name)).toEqual(["Unverified Uma"]);
    expect((await listMembersPage(org.tenantId, { page: 2, pageSize: 2 })).rows).toHaveLength(1);
  });
});

describe("the person's side", () => {
  it("can dismiss the notice, and it stays dismissed", async () => {
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, verifiedId)));
    await dismissAddNotice(verifiedId, m.id);
    expect(await listAddNotices(verifiedId)).toEqual([]);
  });

  it("can leave the organization, but not someone else's membership, and an only Owner can't leave", async () => {
    const [mine] = await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, verifiedId)));
    expect(await leaveOrganization(unverifiedId, mine.id)).toMatchObject({ ok: false }); // not theirs
    expect(await leaveOrganization(verifiedId, mine.id)).toEqual({ ok: true });
    expect(await db.select().from(memberships).where(eq(memberships.id, mine.id))).toHaveLength(0);

    const [owner] = await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.role, "owner")));
    expect(await leaveOrganization(owner.userId, owner.id)).toMatchObject({ ok: false, error: expect.stringMatching(/only Owner/) });
  });
});
