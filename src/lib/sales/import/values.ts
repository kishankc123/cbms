// Reading the cells of an imported sales file. Pure: no database.

export type SalesBillTypeValue = "taxable" | "zero_rated";

/** A money cell: blank is "nothing", and unreadable text is flagged rather than silently becoming zero. */
export function parseAmountCell(cell: string | undefined | null): { value: number | null; invalid: boolean } {
  const raw = (cell ?? "").trim();
  if (raw === "" || raw === "-" || raw === "—") return { value: null, invalid: false };
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const cleaned = raw.replace(/^\((.*)\)$/, "$1").replace(/(npr|nrs|rs\.?|रु\.?|रू\.?)/gi, "").replace(/[,\s]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { value: null, invalid: true };
  const n = Math.round(parseFloat(cleaned) * 100) / 100;
  return { value: negative ? -n : n, invalid: false };
}

const TAXABLE = new Set(["taxable", "tax", "vat", "vatable", "taxed", "13", "13%", "yes", "y", "t"]);
const ZERO = new Set(["zero", "zero rated", "zero-rated", "zerorated", "exempt", "exempted", "nil", "non taxable", "non-taxable", "nontaxable", "no vat", "novat", "no", "n", "0", "0%", "z"]);

/** undefined = the cell is blank (use the default), null = something there isn't a bill type. */
export function parseBillTypeCell(cell: string | undefined | null): SalesBillTypeValue | undefined | null {
  const t = (cell ?? "").trim().toLowerCase();
  if (t === "") return undefined;
  if (TAXABLE.has(t)) return "taxable";
  if (ZERO.has(t)) return "zero_rated";
  return null;
}

/** A name for comparing: lower-case, letters and digits only, spacing collapsed. */
export const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** 0 to 1: how alike two names are, ignoring case, punctuation and word order. */
export function nameSimilarity(x: string, y: string): number {
  const a = normalizeName(x);
  const b = normalizeName(y);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  const direct = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const reordered = 1 - levenshtein(sorted(a), sorted(b)) / Math.max(a.length, b.length);
  const contained = a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)) ? 0.85 : 0;
  return Math.max(direct, reordered, contained);
}

/** The most alike existing name above the cut-off, if any. */
export function bestNameMatch<T extends { name: string }>(text: string, candidates: T[], cutoff = 0.78): { match: T; score: number } | null {
  let best: { match: T; score: number } | null = null;
  for (const c of candidates) {
    const score = nameSimilarity(text, c.name);
    if (score >= cutoff && (!best || score > best.score)) best = { match: c, score };
  }
  return best;
}
