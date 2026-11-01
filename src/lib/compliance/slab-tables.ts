// Client-safe pieces of salary-tax slabs (no database): the taxpayer classes, the shape of a slab table, and the rules a table must follow.

export const TAXPAYER_CLASSES = [
  { key: "single", label: "Single" },
  { key: "couple", label: "Couple" },
] as const;
export type TaxpayerClass = (typeof TAXPAYER_CLASSES)[number]["key"];

/** One income slab: the rate applies to income up to `upTo` (and above the slab before it). The last slab has no limit (upTo null). */
export type Slab = { upTo: number | null; rate: number };
export type SlabTables = Record<TaxpayerClass, Slab[]>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A table is valid when each class has slabs in rising order, rates between 0 and 100, and only the last slab is open-ended. */
export function checkSlabTables(input: unknown): { ok: true; tables: SlabTables } | { ok: false; error: string } {
  const out = {} as SlabTables;
  for (const { key, label } of TAXPAYER_CLASSES) {
    const rows = (input as Record<string, unknown> | null)?.[key];
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: `${label}: add at least one slab.` };
    let previous = 0;
    const slabs: Slab[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as { upTo?: unknown; rate?: unknown };
      const last = i === rows.length - 1;
      const rate = Number(r.rate);
      if (r.rate === "" || r.rate === null || r.rate === undefined || !Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: `${label}, slab ${i + 1}: the rate must be a number between 0 and 100.` };
      if (last) {
        if (r.upTo !== null && r.upTo !== undefined && r.upTo !== "") return { ok: false, error: `${label}: the last slab must have no upper limit.` };
        slabs.push({ upTo: null, rate: round2(rate) });
      } else {
        const upTo = Number(r.upTo);
        if (r.upTo === "" || r.upTo === null || r.upTo === undefined || !Number.isFinite(upTo)) return { ok: false, error: `${label}, slab ${i + 1}: enter where the slab ends.` };
        if (upTo <= previous) return { ok: false, error: `${label}, slab ${i + 1}: it has to end above ${previous.toLocaleString("en-US")}, where the slab before it ends.` };
        slabs.push({ upTo: round2(upTo), rate: round2(rate) });
        previous = upTo;
      }
    }
    out[key] = slabs;
  }
  return { ok: true, tables: out };
}

export function sameSlabTables(a: SlabTables, b: SlabTables): boolean {
  return TAXPAYER_CLASSES.every(({ key }) => a[key].length === b[key].length && a[key].every((s, i) => s.upTo === b[key][i].upTo && s.rate === b[key][i].rate));
}

/** Which rows of `next` differ from the same row of `base` (a row with no counterpart counts as changed), for highlighting. */
export function changedSlabRows(base: Slab[] | undefined, next: { upTo: string | number | null; rate: string | number }[]): boolean[] {
  return next.map((row, i) => {
    const b = base?.[i];
    return !b || (b.upTo === null ? row.upTo !== null && row.upTo !== "" : Number(row.upTo) !== b.upTo || row.upTo === "" || row.upTo === null) || Number(row.rate) !== b.rate;
  });
}

/** The tax on an annual income: each slab's rate on the part of the income that falls in it. */
export function slabTax(slabs: readonly Slab[], income: number): number {
  let tax = 0;
  let from = 0;
  for (const s of slabs) {
    if (income <= from) break;
    const top = s.upTo === null ? income : Math.min(income, s.upTo);
    tax += (top - from) * (s.rate / 100);
    if (s.upTo === null) break;
    from = s.upTo;
  }
  return round2(tax);
}

/** The same working as slabTax, slab by slab: how much of the income fell in each slab and the tax on it (for a payslip). */
export function slabBreakdown(slabs: readonly Slab[], income: number): { from: number; to: number | null; rate: number; amount: number; tax: number }[] {
  const rows: { from: number; to: number | null; rate: number; amount: number; tax: number }[] = [];
  let from = 0;
  for (const s of slabs) {
    const top = s.upTo === null ? Math.max(income, from) : Math.min(Math.max(income, from), s.upTo);
    const amount = round2(Math.max(top - from, 0));
    rows.push({ from, to: s.upTo, rate: s.rate, amount, tax: round2(amount * (s.rate / 100)) });
    if (s.upTo === null) break;
    from = s.upTo;
  }
  return rows;
}
