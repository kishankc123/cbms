// How long a sign-in stays valid. "Remember me" keeps it for 30 days; without
// it the session ends after 12 hours. Enforced on the server (the auth cookie
// itself lives for the maximum), so it also applies if the cookie is copied.
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

export function isSessionExpired(remember: boolean | undefined, loginAt: number | undefined): boolean {
  // Tokens issued before this rule existed carry no login time — re-login.
  if (!loginAt) return true;
  return Date.now() - loginAt > (remember ? REMEMBER_MS : SHORT_SESSION_MS);
}
