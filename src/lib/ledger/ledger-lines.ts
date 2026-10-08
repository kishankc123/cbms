// Which lines of an account ledger to show. A void or an edit reverses an entry with a mirror entry, so both are in the ledger and
// cancel out. They are hidden by default (as pairs) and the running balance is worked out again from what is shown, so every
// figure still adds up. Pure: no database.

export type LedgerLineLike = {
  entryId: string;
  isReversed: boolean;
  reversalOfId: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * With \`showReversed\` off, an original and the entry that reversed it are both left out, but only when both are among these lines:
 * a pair split by the period's edge stays, because the opening balance already includes the original. The running balance is
 * recomputed over the lines that remain, from each line's own effect on the balance.
 */
export function visibleLedgerLines<T extends LedgerLineLike>(lines: T[], openingBalance: number, showReversed: boolean): { lines: T[]; hiddenPairs: number } {
  const ids = new Set(lines.map((l) => l.entryId));
  const hiddenEntries = new Set<string>();
  const pairs = new Set<string>();
  for (const l of lines) {
    if (l.reversalOfId && ids.has(l.reversalOfId)) {
      hiddenEntries.add(l.entryId);
      hiddenEntries.add(l.reversalOfId);
      pairs.add(l.reversalOfId);
    }
  }

  // Each line's effect on the balance (positive increases it), taken from the balance the report already worked out.
  let before = openingBalance;
  const withDelta = lines.map((l) => {
    const delta = round2(l.runningBalance - before);
    before = l.runningBalance;
    return { l, delta };
  });

  let running = openingBalance;
  const out: T[] = [];
  for (const { l, delta } of withDelta) {
    if (!showReversed && hiddenEntries.has(l.entryId)) continue;
    running = round2(running + delta);
    out.push(showReversed ? l : { ...l, runningBalance: running });
  }
  return { lines: out, hiddenPairs: showReversed ? 0 : pairs.size };
}
