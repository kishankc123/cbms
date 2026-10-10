import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, memberships, users } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { authorizeCredentials } from "./credentials";
import { transferOwnership } from "./org-ownership";
import { listRoles } from "./role-store";
import { listPlatformAudit } from "./platform-audit";

const PASSWORD = "Test-Passw0rd!";
const stamp = Date.now();
const email = (n: string) => `zz-${n}-${stamp}@example.test`;
let org: Awaited<ReturnType<typeof createTempOrg>>;
let hash: string;
const made: string[] = [];

async function makeUser(n: string, over: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db.insert(users).values({ name: `ZZ ${n}`, email: email(n), passwordHash: hash, emailVerifiedAt: new Date(), ...over }).returning();
  made.push(u.id);
  return u;
}
async function join(userId: string, systemKey: "owner" | "admin" | "accountant" | "staff", status: "active" | "suspended" = "active") {
  const role = (await listRoles(org.tenantId)).find((r) => r.systemKey === systemKey)!;
  await db.insert(memberships).values({ userId, tenantId: org.tenantId, role: role.baseRole, roleId: role.id, status });
}
const membership = async (userId: string) => (await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.userId, userId))))[0];
const eventsFor = (userId: string) => db.select().from(auditLog).where(and(isNull(auditLog.tenantId), eq(auditLog.userId, userId))).orderBy(auditLog.timestamp);

beforeAll(async () => {
  hash = await bcrypt.hash(PASSWORD, 4);
  org = await createTempOrg("ZZ Roles Users");
});
afterAll(async () => {
  await db.delete(auditLog).where(and(isNull(auditLog.tenantId), sql`${auditLog.afterValue}->>'email' like ${"zz-%-" + stamp + "@example.test"}`));
  if (made.length) await db.delete(auditLog).where(inArray(auditLog.userId, made));
  await org.remove();
  if (made.length) await db.delete(users).where(inArray(users.id, made));
});

describe("sign-in events", () => {
  it("records a successful sign-in, with the time it happened on the account", async () => {
    const u = await makeUser("ok");
    const r = await authorizeCredentials({ email: email("ok").toUpperCase(), password: PASSWORD });
    expect(r).toMatchObject({ id: u.id, email: email("ok") });
    const [ev] = await eventsFor(u.id);
    expect(ev).toMatchObject({ action: "login_succeeded", tenantId: null, entityType: "user", entityId: u.id });
    expect(ev.afterValue).toMatchObject({ email: email("ok") });
    expect(JSON.stringify(ev.afterValue)).not.toContain(PASSWORD); // a password is never recorded
    expect((await db.select().from(users).where(eq(users.id, u.id)))[0].lastLogin).not.toBeNull();
  });

  it("records a wrong password with the reason, and a lock after five of them", async () => {
    const u = await makeUser("lock");
    for (let i = 0; i < 5; i++) expect(await authorizeCredentials({ email: email("lock"), password: "wrong" + i })).toBeNull();
    const events = await eventsFor(u.id);
    expect(events.map((e) => e.action)).toEqual(["login_failed", "login_failed", "login_failed", "login_failed", "login_failed", "account_locked"]);
    expect(events[0].afterValue).toMatchObject({ reason: "wrong_password", failedInARow: 1 });
    expect(events[4].afterValue).toMatchObject({ reason: "wrong_password", failedInARow: 5 });
    expect(events[5].afterValue).toMatchObject({ lockedForMinutes: 15 });
    // while locked, even the right password fails, and that is recorded too
    expect(await authorizeCredentials({ email: email("lock"), password: PASSWORD })).toBeNull();
    const after = await eventsFor(u.id);
    expect(after[after.length - 1]).toMatchObject({ action: "login_failed" });
    expect(after[after.length - 1].afterValue).toMatchObject({ reason: "account_locked" });
  });

  it("records an unknown email and a disabled account", async () => {
    expect(await authorizeCredentials({ email: email("nobody"), password: "x" })).toBeNull();
    const [unknown] = await db.select().from(auditLog).where(and(isNull(auditLog.tenantId), eq(auditLog.action, "login_failed"), sql`${auditLog.afterValue}->>'email' = ${email("nobody")}`));
    expect(unknown).toMatchObject({ userId: null });
    expect(unknown.afterValue).toMatchObject({ reason: "unknown_email" });

    const d = await makeUser("off", { status: "disabled" });
    expect(await authorizeCredentials({ email: email("off"), password: PASSWORD })).toBeNull();
    expect((await eventsFor(d.id))[0].afterValue).toMatchObject({ reason: "account_disabled" });
  });

  it("shows up in the platform audit log, in words, and can be narrowed to failures", async () => {
    const failed = await listPlatformAudit("failed", 200);
    const mine = failed.filter((r) => r.who.includes(String(stamp)));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => /Failed sign-in|Account locked/.test(r.what))).toBe(true);
    expect(mine.some((r) => r.what === "Failed sign-in: wrong password")).toBe(true);
    const signIns = (await listPlatformAudit("sign_ins", 300)).filter((r) => r.who.includes(String(stamp)));
    expect(signIns.some((r) => r.what === "Signed in")).toBe(true);
    const changes = (await listPlatformAudit("changes", 300)).filter((r) => r.who.includes(String(stamp)));
    expect(changes).toHaveLength(0);
  });
});

describe("handing the organization over", () => {
  let owner: typeof users.$inferSelect;
  let admin: typeof users.$inferSelect;
  let staff: typeof users.$inferSelect;
  let outsider: typeof users.$inferSelect;

  beforeAll(async () => {
    owner = await makeUser("owner");
    admin = await makeUser("admin");
    staff = await makeUser("staff");
    outsider = await makeUser("outsider");
    await join(owner.id, "owner");
    await join(admin.id, "admin");
    await join(staff.id, "staff");
  });

  const hand = (over: Partial<Parameters<typeof transferOwnership>[0]> = {}) => transferOwnership({ tenantId: org.tenantId, actingUserId: owner.id, toUserId: admin.id, password: PASSWORD, ...over });

  it("refuses everything that is not allowed, changing nobody's role", async () => {
    expect(await hand({ password: "nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/password/) });
    expect(await hand({ toUserId: owner.id })).toMatchObject({ ok: false, error: expect.stringMatching(/other than yourself/) });
    expect(await hand({ toUserId: outsider.id })).toMatchObject({ ok: false, error: expect.stringMatching(/not a member/) });
    expect(await hand({ actingUserId: staff.id, toUserId: admin.id })).toMatchObject({ ok: false, error: expect.stringMatching(/Only an Owner/) });
    const ownerRole = (await listRoles(org.tenantId)).find((r) => r.systemKey === "owner")!;
    expect(await hand({ stepDownRoleId: ownerRole.id })).toMatchObject({ ok: false, error: expect.stringMatching(/other than Owner/) });
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, admin.id));
    expect(await hand()).toMatchObject({ ok: false, error: expect.stringMatching(/verified/) });
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, admin.id));
    expect((await membership(owner.id)).role).toBe("owner");
    expect((await membership(admin.id)).role).toBe("admin");
  });

  it("makes the other person the Owner and steps the Owner down, in one step, and logs it", async () => {
    const r = await hand();
    expect(r).toMatchObject({ ok: true, newOwner: "ZZ admin", stepDownTo: "Administrator" });
    const roleList = await listRoles(org.tenantId);
    const [nowOwner, nowAdmin] = await Promise.all([membership(admin.id), membership(owner.id)]);
    expect(nowOwner).toMatchObject({ role: "owner", roleId: roleList.find((x) => x.systemKey === "owner")!.id });
    expect(nowAdmin).toMatchObject({ role: "admin", roleId: roleList.find((x) => x.systemKey === "admin")!.id });
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.action, "ownership_transferred")));
    expect(log).toMatchObject({ userId: owner.id, entityType: "organization" });
    expect(log.beforeValue).toMatchObject({ owner: `ZZ owner (${email("owner")})` });
    expect(log.afterValue).toMatchObject({ owner: `ZZ admin (${email("admin")})`, previousOwnerNowHas: "Administrator" });
  });

  it("the person who stepped down can no longer hand it over, and may pick another role to keep", async () => {
    expect(await hand()).toMatchObject({ ok: false, error: expect.stringMatching(/Only an Owner/) });
    // the new Owner hands it on, keeping Accountant for themselves
    const accountant = (await listRoles(org.tenantId)).find((r) => r.systemKey === "accountant")!;
    const r = await transferOwnership({ tenantId: org.tenantId, actingUserId: admin.id, toUserId: staff.id, password: PASSWORD, stepDownRoleId: accountant.id });
    expect(r).toMatchObject({ ok: true, stepDownTo: "Accountant" });
    expect((await membership(staff.id)).role).toBe("owner");
    expect((await membership(admin.id)).role).toBe("accountant");
    // exactly one Owner throughout
    const owners = (await db.select().from(memberships).where(and(eq(memberships.tenantId, org.tenantId), eq(memberships.role, "owner"), eq(memberships.status, "active")))).filter((m) => made.includes(m.userId));
    expect(owners).toHaveLength(1);
  });
});
