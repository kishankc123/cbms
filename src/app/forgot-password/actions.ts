"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createAuthToken } from "@/lib/tokens";
import { sendEmail, passwordResetEmail, appUrl } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Always answers the same way whether or not the email has an account, and the
// link is only ever delivered by email — never returned to the browser.
export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const normalized = email.trim().toLowerCase();
  const allowed = rateLimit(`reset-ip:${await clientIp()}`, 10, 60 * 60 * 1000) && rateLimit(`reset:${normalized}`, 3, 60 * 60 * 1000);
  if (!allowed) return { ok: true };

  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (user && user.status === "active") {
    const token = await createAuthToken(user.id, "password_reset", TOKEN_TTL_MS);
    await sendEmail({ to: user.email, ...passwordResetEmail(`${appUrl()}/reset-password/${token}`) });
  }
  return { ok: true };
}
