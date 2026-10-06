import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { auditLog, memberships, users } from "@/db/schema";
import { createUserAccount } from "./user-accounts";

const email = `zz-user-account-${Date.now()}@example.com`;
afterAll(async () => {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (u) {
    await db.delete(auditLog).where(eq(auditLog.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
});

describe("creating a user account", () => {
  it("makes a global account with a hashed password, unverified, and no organization", async () => {
    const r = await createUserAccount({ fullName: "  Test Person ", email: `  ${email.toUpperCase()} `, mobile: " 9841234567 ", password: "Secret123", confirmPassword: "Secret123" });
    expect(r).toMatchObject({ ok: true, name: "Test Person", email });
    if (!r.ok) return;
    const [u] = await db.select().from(users).where(eq(users.id, r.userId));
    expect(u).toMatchObject({ email, mobile: "9841234567", emailVerifiedAt: null, status: "active", isPlatformAdmin: false });
    expect(await bcrypt.compare("Secret123", u.passwordHash)).toBe(true);
    expect(await db.select().from(memberships).where(eq(memberships.userId, r.userId))).toHaveLength(0);
  });

  it("refuses an email that already has an account, whatever its case", async () => {
    const r = await createUserAccount({ fullName: "Someone Else", email, password: "Secret123", confirmPassword: "Secret123" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
  });

  it("refuses bad details before touching the database", async () => {
    const r = await createUserAccount({ fullName: "X", email: "nope", password: "Secret123", confirmPassword: "Secret123" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/valid email/) });
  });
});
