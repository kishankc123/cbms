// Remembering what an expense description meant last time: the category it went to, when, and for how much. Pure rules, no database.

export type PastExpense = { description: string; categoryAccountId: string; expenseDate: string; subtotal: number; expenseNumber: string };

export type ExpenseSuggestion = {
  /** The description as it was last written. */
  description: string;
  /** How many earlier expenses carry it. */
  times: number;
  last: { categoryAccountId: string; date: string; amount: number; number: string };
  /** The spread of past amounts, once there are enough of them to mean something. */
  range: { min: number; max: number } | null;
  /** Other categories this description has gone to, most used first. */
  others: { categoryAccountId: string; count: number }[];
};

/** Descriptions are compared without case or extra spaces, so "Apple " and "apple" are the same. */
export const normalizeDescription = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The text to match the start of a description against, with the characters LIKE treats specially made literal. */
export const likePrefix = (typed: string) => normalizeDescription(typed).replace(/[%_\\]/g, (c) => "\\" + c) + "%";

/** A range of amounts is only shown from this many earlier expenses. */
export const MIN_FOR_RANGE = 3;

/**
 * The suggestion for what is being typed. `rows` are earlier expenses whose description starts with it, newest first. An exact
 * match to the typed text wins; otherwise the description used most recently does.
 */
export function buildSuggestion(typed: string, rows: PastExpense[]): ExpenseSuggestion | null {
  const wanted = normalizeDescription(typed);
  if (!wanted || rows.length === 0) return null;

  const groups = new Map<string, PastExpense[]>();
  for (const r of rows) {
    const key = normalizeDescription(r.description);
    if (key) groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const chosen = groups.get(wanted) ?? [...groups.values()][0];
  if (!chosen) return null;

  const last = chosen[0];
  const counts = new Map<string, number>();
  for (const r of chosen) counts.set(r.categoryAccountId, (counts.get(r.categoryAccountId) ?? 0) + 1);
  const amounts = chosen.map((r) => r.subtotal);

  return {
    description: last.description.trim(),
    times: chosen.length,
    last: { categoryAccountId: last.categoryAccountId, date: last.expenseDate, amount: last.subtotal, number: last.expenseNumber },
    range: chosen.length >= MIN_FOR_RANGE ? { min: Math.min(...amounts), max: Math.max(...amounts) } : null,
    others: [...counts.entries()]
      .filter(([id]) => id !== last.categoryAccountId)
      .sort((a, b) => b[1] - a[1])
      .map(([categoryAccountId, count]) => ({ categoryAccountId, count })),
  };
}
