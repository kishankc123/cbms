import { createHash, randomBytes } from "crypto";
import { db } from "@/db";
import { authTokens } from "@/db/schema";

// Tokens are emailed in raw form and stored only as a SHA-256 hash, so a
// database leak can't be used to take over accounts.
export const generateToken = () => randomBytes(32).toString("hex");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createAuthToken(userId: string, type: "email_verification" | "password_reset", ttlMs: number) {
  const token = generateToken();
  await db.insert(authTokens).values({ userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}
