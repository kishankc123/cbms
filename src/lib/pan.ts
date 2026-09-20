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
