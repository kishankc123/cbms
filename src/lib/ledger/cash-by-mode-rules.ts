const round2 = (n: number) => Math.round(n * 100) / 100;

export const NO_MODE_LABEL = "No mode recorded";

export type ModeLine = { modeName: string | null; accountId: string; entryId: string; debit: number; credit: number };
export type ModeRow = { mode: string; received: number; paid: number; net: number; transactions: number };
export type ModeAccountRow = { mode: string; accountId: string; received: number; paid: number; transactions: number };

/** Adds money in (debits) and money out (credits) up by payment mode; lines posted before modes existed share one row. */
export function groupByMode(lines: readonly ModeLine[]): { byMode: ModeRow[]; byModeAndAccount: ModeAccountRow[] } {
  const modes = new Map<string, { received: number; paid: number; entries: Set<string> }>();
  const pairs = new Map<string, { mode: string; accountId: string; received: number; paid: number; entries: Set<string> }>();
  for (const l of lines) {
    const mode = l.modeName ?? NO_MODE_LABEL;
    const m = modes.get(mode) ?? { received: 0, paid: 0, entries: new Set<string>() };
    m.received += l.debit;
    m.paid += l.credit;
    m.entries.add(l.entryId);
    modes.set(mode, m);
    const key = mode + "|" + l.accountId;
    const p = pairs.get(key) ?? { mode, accountId: l.accountId, received: 0, paid: 0, entries: new Set<string>() };
    p.received += l.debit;
    p.paid += l.credit;
    p.entries.add(l.entryId);
    pairs.set(key, p);
  }
  const rank = (name: string) => (name === NO_MODE_LABEL ? 1 : 0); // the leftover row goes last
  const byMode = [...modes.entries()]
    .map(([mode, m]) => ({ mode, received: round2(m.received), paid: round2(m.paid), net: round2(m.received - m.paid), transactions: m.entries.size }))
    .sort((a, b) => rank(a.mode) - rank(b.mode) || b.received + b.paid - (a.received + a.paid));
  const byModeAndAccount = [...pairs.values()]
    .map((p) => ({ mode: p.mode, accountId: p.accountId, received: round2(p.received), paid: round2(p.paid), transactions: p.entries.size }))
    .sort((a, b) => rank(a.mode) - rank(b.mode) || a.mode.localeCompare(b.mode) || b.received + b.paid - (a.received + a.paid));
  return { byMode, byModeAndAccount };
}
