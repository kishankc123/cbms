import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, tenants, users } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { forceSignOut, getPlatformOrg, getPlatformUser, listPlatformOrgs, listPlatformUsers, platformCounts, setOrgStatus, setPlatformAdmin, setUserStatus, unlockUser } from "./platform-admin";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const stamp = Date.now();
let actorId: string;
let targetId: string;
let unverifiedId: string;
const emails = { actor: `zz-pa-actor-${stamp}@example.com`, target: `zz-pa-target-${stamp}@example.com`, unverified: `zz-pa-unverified-${stamp}@example.com` };

const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Platform Admin");
  const made = await db
    .insert(users)
    .values([
      { name: "Actor Admin", email: emails.actor, passwordHash: "x", emailVerifiedAt: new Date(), isPlatformAdmin: true },
      { name: "Target Person", email: emails.target, passwordHash: "x", emailVerifiedAt: new Date(), failedLoginCount: 3, lockedUntil: new Date(Date.now() + 3600_000) },
      { name: "Unverified Una", email: emails.unverified, passwordHash: "x" },
    ])
    .returning({ id: users.id, email: users.email });
  actorId = made.find((u) => u.email === emails.actor)!.id;
  targetId = made.find((u) => u.email === emails.target)!.id;
  unverifiedId = made.find((u) => u.email === emails.unverified)!.id;
});
afterAll(async () => {
  await org.remove();
  const ids = [actorId, targetId, unverifiedId].filter(Boolean);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
});

describe("users across the platform", () => {
  it("lists and searches every account, with their organization count and lock state", async () => {
    const found = await listPlatformUsers({ search: `zz-pa-target-${stamp}`, page: 1, pageSize: 25 });
    expect(found.total).toBe(1);
    expect(found.rows[0]).toMatchObject({ name: "Target Person", verified: true, locked: true, organizations: 0, isPlatformAdmin: false });
    expect((await listPlatformUsers({ search: `zz-pa-unverified-${stamp}`, page: 1, pageSize: 25 })).rows[0].verified).toBe(false);
    expect((await listPlatformUsers({ admins: true, search: `zz-pa-`, page: 1, pageSize: 25 })).rows.map((r) => r.name)).toEqual(["Actor Admin"]);
    expect((await platformCounts()).users.total).toBeGreaterThanOrEqual(3);
  });

  it("shows an account's organizations", async () => {
    const detail = await getPlatformUser(org.userId);
    expect(detail!.organizations.some((o) => o.name.includes("ZZ Platform Admin") && o.roleName === "Owner")).toBe(true);
  });
});

describe("account controls", () => {
  it("unlocks a locked account", async () => {
    expect(await unlockUser(actorId, targetId)).toEqual({ ok: true });
    expect(await row(targetId)).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("force sign-out invalidates every session by moving the session version", async () => {
    const before = (await row(targetId)).sessionVersion;
    expect(await forceSignOut(actorId, targetId)).toEqual({ ok: true });
    expect((await row(targetId)).sessionVersion).toBe(before + 1);
  });

  it("disables and re-enables an account, signing the person out; never one's own", async () => {
    const before = (await row(targetId)).sessionVersion;
    expect(await setUserStatus(actorId, targetId, "disabled")).toEqual({ ok: true });
    expect(await row(targetId)).toMatchObject({ status: "disabled", sessionVersion: before + 1 });
    expect(await setUserStatus(actorId, targetId, "active")).toEqual({ ok: true });
    expect((await row(targetId)).status).toBe("active");
    expect(await setUserStatus(actorId, actorId, "disabled")).toMatchObject({ ok: false, error: expect.stringMatching(/your own/) });
  });

  it("grants platform admin only to an active, verified account, and revoking ends their sessions", async () => {
    expect(await setPlatformAdmin(actorId, unverifiedId, true)).toMatchObject({ ok: false, error: expect.stringMatching(/verified/) });
    expect(await setPlatformAdmin(actorId, targetId, true)).toEqual({ ok: true });
    expect((await row(targetId)).isPlatformAdmin).toBe(true);
    const before = (await row(targetId)).sessionVersion;
    expect(await setPlatformAdmin(actorId, targetId, false)).toEqual({ ok: true });
    expect(await row(targetId)).toMatchObject({ isPlatformAdmin: false, sessionVersion: before + 1 });
    expect(await setPlatformAdmin(actorId, actorId, false)).toMatchObject({ ok: false, error: expect.stringMatching(/your own/) });
  });

  it("records each change in the platform audit trail with who made it", async () => {
    const events = await db.select().from(auditLog).where(eq(auditLog.userId, actorId));
    const actions = events.map((e) => e.action);
    for (const a of ["platform_user_unlocked", "platform_user_signed_out", "platform_user_disabled", "platform_user_enabled", "platform_admin_granted", "platform_admin_revoked"]) expect(actions).toContain(a);
    expect(events.every((e) => e.tenantId === null)).toBe(true);
  });
});

describe("organizations across the platform", () => {
  it("lists and searches organizations with their owner and member count", async () => {
    const found = await listPlatformOrgs({ search: "ZZ Platform Admin", page: 1, pageSize: 25 });
    const mine = found.rows.find((r) => r.id === org.tenantId)!;
    expect(mine).toMatchObject({ status: "active", members: 1, plan: "trial" });
    expect(mine.owner).toBeTruthy();
  });

  it("suspends with a reason (required), blocks nothing else, and reactivates", async () => {
    expect(await setOrgStatus(actorId, org.tenantId, "suspended", "  ")).toMatchObject({ ok: false, error: expect.stringMatching(/reason/) });
    expect(await setOrgStatus(actorId, org.tenantId, "suspended", "Unpaid subscription")).toEqual({ ok: true });
    expect((await db.select().from(tenants).where(eq(tenants.id, org.tenantId)))[0].status).toBe("suspended");
    const detail = await getPlatformOrg(org.tenantId);
    expect(detail!.events[0]).toMatchObject({ action: "organization_suspended", reason: "Unpaid subscription" });
    expect(detail!.members).toHaveLength(1);

    expect(await setOrgStatus(actorId, org.tenantId, "active", "")).toEqual({ ok: true });
    expect((await db.select().from(tenants).where(eq(tenants.id, org.tenantId)))[0].status).toBe("active");
    expect(await setOrgStatus(actorId, "00000000-0000-0000-0000-000000000000", "suspended", "x")).toMatchObject({ ok: false });
  });
});
