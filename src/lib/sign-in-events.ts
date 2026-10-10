// The sign-in events kept in the audit log, and how they read. Plain data: safe to use on screens.

export type SignInEvent = "login_succeeded" | "login_failed" | "account_locked";

export const SIGN_IN_EVENTS: SignInEvent[] = ["login_succeeded", "login_failed", "account_locked"];

const FAIL_REASON: Record<string, string> = {
  unknown_email: "no account with that email",
  account_disabled: "the account is disabled",
  account_locked: "the account is locked after too many wrong passwords",
  wrong_password: "wrong password",
};

/** "Signed in", "Failed sign-in: wrong password" — one event in words. */
export function describeSignInEvent(action: string, after: unknown): string | null {
  const a = (after ?? {}) as { reason?: string; lockedForMinutes?: number };
  if (action === "login_succeeded") return "Signed in";
  if (action === "login_failed") return `Failed sign-in${a.reason ? `: ${FAIL_REASON[a.reason] ?? a.reason}` : ""}`;
  if (action === "account_locked") return `Account locked${a.lockedForMinutes ? ` for ${a.lockedForMinutes} minutes` : ""} after too many wrong passwords`;
  return null;
}
