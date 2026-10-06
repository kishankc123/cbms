"use server";

import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createAuthToken } from "@/lib/tokens";
import { sendEmail, verificationEmail, appUrl } from "@/lib/email";
import { createUserAccount } from "@/lib/user-accounts";
import type { UserAccountInput } from "@/lib/user-account-rules";

/** A person's own account: no organization comes with it. Organizations add them later, by this email. */
export async function registerUserAccount(input: UserAccountInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!rateLimit(`register-user:${await clientIp()}`, 5, 60 * 60 * 1000)) return { ok: false, error: "Too many attempts. Please try again later." };

  const created = await createUserAccount(input);
  if (!created.ok) return created;

  const token = await createAuthToken(created.userId, "email_verification", 24 * 60 * 60 * 1000);
  await sendEmail({ to: created.email, ...verificationEmail(created.name, `${appUrl()}/verify-email/${token}`) });
  return { ok: true };
}
