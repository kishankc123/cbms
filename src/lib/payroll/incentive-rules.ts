// Performance incentives, the parts that need no database. A heading is published once (name, how often, taxable or not, counted for retirement or not);
// each period a round says who gets how much under it, and approved rounds flow into the salary sheet of their pay month.

export type IncentiveFrequency = "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_off";

export const FREQUENCY_LABEL: Record<IncentiveFrequency, string> = {
  monthly: "Every month",
  quarterly: "Every quarter",
  half_yearly: "Every half year",
  yearly: "Every year",
  one_off: "One-off, when announced",
};
export const FREQUENCIES = Object.keys(FREQUENCY_LABEL) as IncentiveFrequency[];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A starting label for a round: the pay month for a monthly heading, the quarter or half it falls in, or the year. The person can change it. */
export function suggestPeriodLabel(frequency: IncentiveFrequency, monthName: string, year: number, month: number): string {
  switch (frequency) {
    case "monthly":
      return `${monthName} ${year}`;
    case "quarterly":
      return `Quarter ${Math.ceil(month / 3)} ${year}`;
    case "half_yearly":
      return `Half ${month <= 6 ? 1 : 2} ${year}`;
    case "yearly":
      return `Year ${year}`;
    default:
      return "";
  }
}

export type EntryInput = { employeeId: string; amount: number; note: string };

/** What is wrong with a round's entries, in plain words, or null. Empty rows (no employee and no amount) are ignored by the caller. */
export function entryProblem(entries: EntryInput[]): string | null {
  for (const [i, e] of entries.entries()) {
    const row = `Row ${i + 1}`;
    if (!e.employeeId) return `${row}: choose the employee.`;
    if (!Number.isFinite(e.amount) || e.amount <= 0) return `${row}: enter an amount above zero.`;
    if (e.amount > 1_000_000_000) return `${row}: that amount is too large.`;
  }
  return null;
}

export type IncentiveHeading = { id: string; name: string; taxable: boolean; countsForRetirement: boolean };
export type ApprovedEntry = { employeeId: string; headingId: string; amount: number };
export type IncentiveLine = { headingId: string; name: string; amount: number; taxable: boolean; countsForRetirement: boolean };
export type IncentivePay = { lines: IncentiveLine[]; total: number; taxable: number; retirement: number };

/** One employee's incentives for a month: one line per heading (several entries under a heading add up), and the totals tax and retirement are worked on. */
export function incentivePay(employeeId: string, entries: ApprovedEntry[], headings: IncentiveHeading[]): IncentivePay {
  const byHeading = new Map(headings.map((h) => [h.id, h]));
  const sums = new Map<string, number>();
  for (const e of entries) if (e.employeeId === employeeId && byHeading.has(e.headingId)) sums.set(e.headingId, round2((sums.get(e.headingId) ?? 0) + e.amount));
  const lines: IncentiveLine[] = [...sums.entries()]
    .map(([headingId, amount]) => ({ headingId, name: byHeading.get(headingId)!.name, amount, taxable: byHeading.get(headingId)!.taxable, countsForRetirement: byHeading.get(headingId)!.countsForRetirement }))
    .filter((l) => l.amount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const sum = (f: (l: IncentiveLine) => boolean) => round2(lines.filter(f).reduce((s, l) => s + l.amount, 0));
  return { lines, total: sum(() => true), taxable: sum((l) => l.taxable), retirement: sum((l) => l.countsForRetirement) };
}
