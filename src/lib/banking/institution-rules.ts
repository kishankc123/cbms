// Banks and wallets as a person sees them: their initials and colour when there is no logo, what a logo file may be, and the starting list.
// Pure (no database), so the screens and the tests use the same rules.

export type InstitutionKind = "bank" | "development_bank" | "wallet";
/** The group headings in the picker, and one entry's type. The order here is the order shown. */
export const KIND_LABEL: Record<InstitutionKind, string> = { bank: "Commercial banks", development_bank: "Development banks", wallet: "Wallets" };
export const KIND_NAME: Record<InstitutionKind, string> = { bank: "Commercial bank", development_bank: "Development bank", wallet: "Wallet" };
export const isKind = (k: string): k is InstitutionKind => k in KIND_LABEL;

export type Institution = { id: string; name: string; code: string | null; kind: InstitutionKind; isActive: boolean; hasLogo: boolean; updatedAt: string };

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

/** The one entry a logo file belongs to, by its file name ("nabil.svg" -> NABIL, or the start of the name). Null when none or several match. */
export function institutionForFile(fileName: string, list: { id: string; name: string; code?: string | null }[]): string | null {
  const key = slug(fileName.replace(/\.[^.]+$/, ""));
  if (!key) return null;
  const exact = list.filter((i) => slug(i.name) === key || slug(i.code ?? "") === key);
  const found = exact.length ? exact : list.filter((i) => slug(i.name).startsWith(key));
  return found.length === 1 ? found[0].id : null;
}

/** What a bank or wallet is usually paid through, to tick the payment modes it can be used for. */
export const defaultModeNames = (kind: InstitutionKind, name: string): string[] => (kind === "wallet" ? ["Wallet", name] : ["Bank transfer", "Cheque"]);

// The starting list for Nepal: the commercial banks and the main wallets with their short codes. Unverified, to be checked and edited by the platform administrator.
const banks = [
  ["Nepal Bank Limited", "NBL"],
  ["Agriculture Development Bank Limited", "ADBL"],
  ["Nabil Bank Limited", "NABIL"],
  ["Nepal Investment Mega Bank Limited", "NIMB"],
  ["Standard Chartered Bank Nepal Limited", "SCBNL"],
  ["Himalayan Bank Limited", "HBL"],
  ["Nepal SBI Bank Limited", "NSBI"],
  ["Everest Bank Limited", "EBL"],
  ["Kumari Bank Limited", "KBL"],
  ["Laxmi Sunrise Bank Limited", "LSBL"],
  ["Citizens Bank International Limited", "CBL"],
  ["Prime Commercial Bank Limited", "PCBL"],
  ["Sanima Bank Limited", "SANIMA"],
  ["Machhapuchchhre Bank Limited", "MBL"],
  ["NIC ASIA Bank Limited", "NICASIA"],
  ["Global IME Bank Limited", "GIBL"],
  ["NMB Bank Limited", "NMB"],
  ["Prabhu Bank Limited", "PRABHU"],
  ["Siddhartha Bank Limited", "SBL"],
  ["Rastriya Banijya Bank Limited", "RBB"],
];
const developmentBanks = [
  ["Mahalaxmi Bikas Bank Limited", "MBLDB"],
  ["Narayani Development Bank Limited", "NDBL"],
  ["Karnali Development Bank Limited", "KDBL"],
  ["Shangrila Development Bank Limited", "SDBL"],
  ["Excel Development Bank Limited", "EDBL"],
  ["Miteri Development Bank Limited", "MITERI"],
  ["Muktinath Bikas Bank Limited", "MUKTI"],
  ["Garima Bikas Bank Limited", "GARIMA"],
  ["Kamana Sewa Bikas Bank Limited", "KSBBL"],
  ["Corporate Development Bank Limited", "CDBL"],
  ["Jyoti Bikas Bank Limited", "JBBL"],
  ["Shine Resunga Development Bank Limited", "SRDBL"],
  ["Lumbini Bikas Bank Limited", "LBBL"],
  ["Sindhu Bikas Bank Limited", "SINDHU"],
  ["Salapa Bikas Bank Limited", "SALAPA"],
  ["Saptakoshi Development Bank Limited", "SAPTAKOSHI"],
  ["Green Development Bank Limited", "GDBL"],
];
const wallets = [["eSewa", "ESEWA"], ["Khalti", "KHALTI"], ["IME Pay", "IMEPAY"]];
export const STARTING_INSTITUTIONS: { name: string; code: string; kind: InstitutionKind }[] = [
  ...banks.map(([name, code]) => ({ name, code, kind: "bank" as const })),
  ...developmentBanks.map(([name, code]) => ({ name, code, kind: "development_bank" as const })),
  ...wallets.map(([name, code]) => ({ name, code, kind: "wallet" as const })),
];

/** The starting entries a country's list does not have yet (by name), so the starting list can be loaded again to add what is new. */
export const missingStarting = (have: { name: string }[]) => STARTING_INSTITUTIONS.filter((s) => !have.some((h) => h.name.toLowerCase() === s.name.toLowerCase()));
