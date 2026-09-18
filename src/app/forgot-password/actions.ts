"use server";

import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function requestPasswordReset(email: string): Promise<{ resetUrl: string | null }> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { resetUrl: null };

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.insert(passwordResetTokens).values({ userId: user.id, token, expiresAt });

  // No email provider is configured yet, so the link is handed back directly
  // instead of being emailed.
  return { resetUrl: `/reset-password/${token}` };
}
