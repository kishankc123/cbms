// Banks and wallets as a person sees them: their initials and colour when there is no logo, what a logo file may be, and the starting list.
// Pure (no database), so the screens and the tests use the same rules.

export type InstitutionKind = "bank" | "wallet";
export const KIND_LABEL: Record<InstitutionKind, string> = { bank: "Banks", wallet: "Wallets" };

export type Institution = { id: string; name: string; kind: InstitutionKind; isActive: boolean; hasLogo: boolean; updatedAt: string };

/** "Nabil Bank" -> "NB", "eSewa" -> "ES": the first letters of the first two words, or the first two letters of a single word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** The same colour for the same name every time, from a small set that reads well with white letters. */
const COLOURS = ["#1d6fb8", "#c0392b", "#d98a1a", "#2f8f5b", "#7a4fb5", "#3aa64a", "#5b3fa0", "#0f766e"];
export const colourOf = (name: string): string => COLOURS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLOURS.length];

export const logoUrl = (i: Pick<Institution, "id" | "updatedAt">) => `/api/bank-logo/${i.id}?v=${encodeURIComponent(i.updatedAt)}`;

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LOGO_MAX_BYTES = 40_000;

/** Why a logo file cannot be used, or null. An SVG that carries a script is refused. */
export function logoProblem(type: string, bytes: number, text?: string): string | null {
  if (!LOGO_TYPES.includes(type)) return "A logo must be a PNG, JPEG, WebP or SVG picture.";
  if (bytes > LOGO_MAX_BYTES) return `A logo can be at most ${LOGO_MAX_BYTES / 1000} KB. Use a smaller picture.`;
  if (type === "image/svg+xml" && /<script|\son\w+\s*=|javascript:|<foreignObject/i.test(text ?? "")) return "That SVG contains a script, so it can't be used.";
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The one entry a logo file belongs to, by its file name ("nabil.svg" -> Nabil Bank): the name starts with it. Null when none or several match. */
export function institutionForFile(fileName: string, list: { id: string; name: string }[]): string | null {
  const key = slug(fileName.replace(/\.[^.]+$/, ""));
  if (!key) return null;
  const exact = list.filter((i) => slug(i.name) === key);
  const found = exact.length ? exact : list.filter((i) => slug(i.name).startsWith(key));
  return found.length === 1 ? found[0].id : null;
}

/** What a bank or wallet is usually paid through, to tick the payment modes it can be used for. */
export const defaultModeNames = (kind: InstitutionKind, name: string): string[] => (kind === "bank" ? ["Bank transfer", "Cheque"] : ["Wallet", name]);

// The starting list for Nepal: unverified, to be checked and edited by the platform administrator (banks merge and change names).
const banks = [
  "Nabil Bank", "Nepal Investment Mega Bank", "Standard Chartered Bank Nepal", "Himalayan Bank", "Nepal SBI Bank", "Everest Bank", "NIC Asia Bank", "Machhapuchchhre Bank",
  "Kumari Bank", "Laxmi Sunrise Bank", "Siddhartha Bank", "Global IME Bank", "Citizens Bank International", "Prime Commercial Bank", "NMB Bank", "Prabhu Bank", "Sanima Bank",
  "Agricultural Development Bank", "Nepal Bank", "Rastriya Banijya Bank",
];
const wallets = ["eSewa", "Khalti", "IME Pay", "Fonepay", "PrabhuPay", "CellPay"];
export const STARTING_INSTITUTIONS: { name: string; kind: InstitutionKind }[] = [...banks.map((name) => ({ name, kind: "bank" as const })), ...wallets.map((name) => ({ name, kind: "wallet" as const }))];
