// A cash count: the notes someone counted at the end of the day, against what the books say. Pure; nothing here touches the books.

/** The notes in circulation, largest first. Coins and anything else go in "other". */
export const NOTE_VALUES = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type CountedNotes = Record<string, number>;
export type SavedCount = { accountId: string; notes: CountedNotes; other: number; counted: number; book: number; remark: string; updatedAt: string };

/** Keeps only whole, non-negative counts of known notes. Returns null if anything else was entered, so a typing mistake is never saved as a smaller count. */
export function cleanNotes(raw: Record<string, unknown>): CountedNotes | null {
  const out: CountedNotes = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(NOTE_VALUES as readonly number[]).includes(Number(k))) return null;
    const n = typeof v === "string" ? (v.trim() === "" ? 0 : Number(v)) : (v as number);
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
    if (n > 0) out[k] = n;
  }
  return out;
}

export function countedTotal(notes: CountedNotes, other: number): number {
  return round2(Object.entries(notes).reduce((s, [k, n]) => s + Number(k) * n, 0) + other);
}

export type CountResult = { counted: number; book: number; difference: number; status: "matches" | "short" | "over" };

/** Counted minus the books: short means there is less cash than the books say. */
export function compareCount(counted: number, book: number): CountResult {
  const difference = round2(counted - book);
  return { counted: round2(counted), book: round2(book), difference, status: Math.abs(difference) < 0.005 ? "matches" : difference < 0 ? "short" : "over" };
}
