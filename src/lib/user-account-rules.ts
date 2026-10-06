import { isEmail, validatePassword } from "@/lib/password";

// The sign-up rules for a person's own account, with no database.

export type UserAccountInput = { fullName: string; email: string; mobile?: string; password: string; confirmPassword: string };

/** Digits with an optional leading +, spaces and dashes allowed between them (7 to 15 digits). */
export function mobileError(mobile: string | undefined): string | null {
  const m = (mobile ?? "").trim();
  if (!m) return null;
  if (!/^\+?[0-9][0-9 \-]*$/.test(m)) return "Enter the contact number using digits only (a leading + is fine).";
  const digits = m.replace(/\D/g, "").length;
  return digits < 7 || digits > 15 ? "The contact number must have between 7 and 15 digits." : null;
}

/** The first problem with the sign-up details, in the order the form asks for them, or null when they are fine. */
export function userAccountProblem(input: UserAccountInput): string | null {
  if (!input.fullName.trim()) return "Full name is required.";
  if (!isEmail(input.email.trim().toLowerCase())) return "Enter a valid email address.";
  const mobile = mobileError(input.mobile);
  if (mobile) return mobile;
  if (input.password !== input.confirmPassword) return "Passwords do not match.";
  return validatePassword(input.password);
}
