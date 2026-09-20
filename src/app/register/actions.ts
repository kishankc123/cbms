"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createOrganization, type BusinessInfo } from "@/lib/organizations";
import { validatePassword, isEmail } from "@/lib/password";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createAuthToken } from "@/lib/tokens";
import { sendEmail, verificationEmail, appUrl } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

export type RegisterInput = {
  business: BusinessInfo;
  admin: { fullName: string; email: string; mobile?: string; password: string; confirmPassword: string };
};

export async function registerOrganization(input: RegisterInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!rateLimit(`register:${await clientIp()}`, 5, 60 * 60 * 1000)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const { business, admin } = input;
  const email = admin.email.trim().toLowerCase();
  if (!business.name.trim()) return { ok: false, error: "Business name is required." };
  if (!admin.fullName.trim()) return { ok: false, error: "Full name is required." };
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (admin.password !== admin.confirmPassword) return { ok: false, error: "Passwords do not match." };
  const pwError = validatePassword(admin.password);
  if (pwError) return { ok: false, error: pwError };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return { ok: false, error: "An account with this email already exists. Sign in instead — you can add another organization from inside the app." };
  }

  const [user] = await db
    .insert(users)
    .values({
      name: admin.fullName.trim(),
      email,
      mobile: admin.mobile?.trim() || null,
      passwordHash: await bcrypt.hash(admin.password, 12),
    })
    .returning();

  try {
    await createOrganization(business, user.id);
  } catch (e) {
    await db.delete(users).where(eq(users.id, user.id));
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the account." };
  }

  await logAuditEvent({ userId: user.id, action: "account_created", entityType: "user", entityId: user.id, after: { email } });

  const token = await createAuthToken(user.id, "email_verification", 24 * 60 * 60 * 1000);
  const mail = verificationEmail(user.name, `${appUrl()}/verify-email/${token}`);
  await sendEmail({ to: email, ...mail });

  return { ok: true };
}
