// One bank line is sometimes several payments at once (five invoices paid in a single deposit). When no single book entry matches,
// this looks for the entries that add up to the bank amount. It only answers when the answer is clear, and the screen shows it as a
// likely match that still needs the person's OK: nothing is ever matched by this alone.

export const COMBINATION_WINDOW_DAYS = 10;
const MAX_ENTRIES = 8;
const MAX_POOL = 30;
const MAX_WORK = 200_000;
const MAX_SOLUTIONS = 200;

export type CombinationEntry = { id: string; cents: number; date: string };

const dayGap = (a: string, b: string) => Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000;

/**
 * The two or more entries that add up to `target` (in cents, signed like the entries), or null when there is no such set or no clear
 * one. Several sets can add up to the same amount; the set whose dates are closest to the bank line wins, and a tie is not a clear
 * answer. Only entries on the same side as the bank line (money in or money out) count.
 */
export function findCombination(entries: CombinationEntry[], target: number, lineDate: string): string[] | null {
  if (target === 0) return null;
  const sign = Math.sign(target);
  const pool = entries
    .filter((e) => Math.sign(e.cents) === sign && Math.abs(e.cents) < Math.abs(target))
    .sort((a, b) => dayGap(a.date, lineDate) - dayGap(b.date, lineDate))
    .slice(0, MAX_POOL)
    .map((e) => ({ ...e, cents: Math.abs(e.cents) }))
    .sort((a, b) => b.cents - a.cents);
  const want = Math.abs(target);
  const suffix: number[] = new Array(pool.length + 1).fill(0);
  for (let i = pool.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + pool[i].cents;

  const found: number[][] = [];
  let work = 0;
  const walk = (start: number, left: number, chosen: number[]) => {
    if (left === 0) {
      if (chosen.length >= 2) found.push([...chosen]);
      return;
    }
    if (chosen.length >= MAX_ENTRIES || found.length >= MAX_SOLUTIONS) return;
    for (let i = start; i < pool.length; i++) {
      if (++work > MAX_WORK) return;
      if (suffix[i] < left) return; // what is left cannot reach the amount
      if (pool[i].cents > left) continue;
      chosen.push(i);
      walk(i + 1, left - pool[i].cents, chosen);
      chosen.pop();
    }
  };
  walk(0, want, []);
  if (found.length === 0) return null;

  const closeness = (set: number[]) => set.reduce((s, i) => s + dayGap(pool[i].date, lineDate), 0);
  const ranked = found.map((set) => ({ set, score: closeness(set) })).sort((a, b) => a.score - b.score);
  if (ranked.length > 1 && ranked[1].score - ranked[0].score < 1e-9) return null; // two sets equally close: not clear
  return ranked[0].set.map((i) => pool[i].id);
}
