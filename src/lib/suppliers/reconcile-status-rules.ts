// How far a supplier's account has been reconciled, from the periods that were signed off. No database.

export type Period = { from: string; to: string };

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The signed-off periods joined where they touch or overlap, the last day covered, and any gap between them (Q1 and Q3 signed off, Q2 not). "Reconciled up
 * to" is only a fair thing to say when there is no gap, so the gaps are reported alongside it.
 */
export function coverage(periods: Period[]): { through: string | null; merged: Period[]; gaps: Period[] } {
  const sorted = [...periods].filter((p) => p.from && p.to && p.from <= p.to).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const merged: Period[] = [];
  for (const p of sorted) {
    const last = merged[merged.length - 1];
    if (last && p.from <= addDays(last.to, 1)) last.to = p.to > last.to ? p.to : last.to;
    else merged.push({ ...p });
  }
  const gaps: Period[] = [];
  for (let i = 1; i < merged.length; i++) gaps.push({ from: addDays(merged[i - 1].to, 1), to: addDays(merged[i].from, -1) });
  return { through: merged.length ? merged[merged.length - 1].to : null, merged, gaps };
}

/** Whether a date falls inside any of the signed-off periods. */
export const reconciledOn = (periods: Period[], date: string) => periods.some((p) => date >= p.from && date <= p.to);
