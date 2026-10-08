import { normalizeDigits } from "@/lib/calendar";

// A Nepali PAN is exactly nine digits. Nepali (Devanagari) digits are accepted and stored as 0-9.
export const PAN_LENGTH = 9;

export const normalizePan = (v: unknown) => normalizeDigits(String(v ?? "")).replace(/\s+/g, "");

/** null when valid; otherwise the message to show. */
export function panError(v: unknown, label = "PAN"): string | null {
  const pan = normalizePan(v);
  if (!pan) return `${label} is required`;
  if (!/^\d{9}$/.test(pan)) return `${label} must be exactly 9 digits`;
  return null;
}

/** The normalised PAN, or throws with the message. */
export function requirePan(v: unknown, label = "PAN"): string {
  const error = panError(v, label);
  if (error) throw new Error(error);
  return normalizePan(v);
}

/** For a PAN that may be left blank (customers, suppliers): null when blank or valid; otherwise the message to show. */
export function optionalPanError(v: unknown, label = "PAN"): string | null {
  return normalizePan(v) ? panError(v, label) : null;
}

/** The normalised PAN, "" when it was left blank, or throws with the message when something was typed that is not a PAN. */
export function optionalPan(v: unknown, label = "PAN"): string {
  const error = optionalPanError(v, label);
  if (error) throw new Error(error);
  return normalizePan(v);
}
