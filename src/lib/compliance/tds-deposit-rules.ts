import { sumFines, type HeadFine } from "./tds-fines";

// How much TDS withheld has been deposited, by deposit period and heading (no database, safe for the browser). A deposit is made against one
// compliance item (one period) and split by heading, so a position is known per heading and per period, not per withholding line.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type DepositStatus = "deposited" | "part" | "none" | "no_item";

export type DepositMonthRow = {
  /** The deposit item the period belongs to; null when TDS was withheld in a period that has no deposit item. */
  obligationId: string | null;
  period: string;
  periodStart: string;
  periodEnd: string;
  headKey: string | null;
  heading: string;
  withheld: number;
  deposited: number;
  /** Never negative: depositing more than was withheld does not make another period's amount smaller. */
  remaining: number;
  status: DepositStatus;
  /** Late-deposit fine and interest to the report date, for this heading and period. null when the country has no TDS fine rules, or there is no deposit item. */
  fine: HeadFine | null;
};

/** What the fines were worked out on, so a screen can say so: the date they run to, and whether the rates are missing or not yet verified. */
export type FineBasis = { asOf: string; missingRule: boolean; unverified: boolean };
export type TdsDepositPosition = { rows: DepositMonthRow[]; byHeading: HeadingPosition[]; fineBasis: FineBasis };

export function depositStatus(withheld: number, deposited: number, hasItem: boolean): DepositStatus {
  if (!hasItem) return "no_item";
  const remaining = round2(withheld - deposited);
  if (withheld > 0.004 && remaining <= 0.004) return "deposited";
  if (deposited > 0.004 && remaining > 0.004) return "part";
  return "none";
}

export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = { deposited: "Deposited", part: "Part deposited", none: "Not deposited", no_item: "No deposit item" };

export type HeadingPosition = { headKey: string | null; heading: string; withheld: number; deposited: number; remaining: number; status: DepositStatus; fine: HeadFine | null };

/** The by-period rows added up by heading, in the order the headings first appear. Months with no deposit item count as not deposited. */
export function positionByHeading(rows: DepositMonthRow[]): HeadingPosition[] {
  const byKey = new Map<string | null, { headKey: string | null; heading: string; withheld: number; deposited: number; remaining: number; hasGap: boolean; fines: HeadFine[] }>();
  for (const r of rows) {
    const t = byKey.get(r.headKey) ?? { headKey: r.headKey, heading: r.heading, withheld: 0, deposited: 0, remaining: 0, hasGap: false, fines: [] };
    t.withheld = round2(t.withheld + r.withheld);
    t.deposited = round2(t.deposited + r.deposited);
    t.remaining = round2(t.remaining + r.remaining);
    if (r.status === "no_item") t.hasGap = true;
    if (r.fine) t.fines.push(r.fine);
    byKey.set(r.headKey, t);
  }
  return [...byKey.values()].map((t) => ({ headKey: t.headKey, heading: t.heading, withheld: t.withheld, deposited: t.deposited, remaining: t.remaining, status: t.hasGap && t.deposited <= 0.004 ? "no_item" : depositStatus(t.withheld, t.deposited, true), fine: t.fines.length > 0 ? sumFines(t.fines) : null }));
}

/** Withheld in months that no deposit item covers: grouped by calendar month and heading, so a gap in the schedule cannot hide. */
export function uncoveredRows(
  lines: { date: string; tds: number; headKey: string | null }[],
  periods: { periodStart: string; periodEnd: string }[],
  nameOf: (key: string | null) => string
): DepositMonthRow[] {
  const covered = (d: string) => periods.some((p) => d >= p.periodStart && d <= p.periodEnd);
  const groups = new Map<string, DepositMonthRow>();
  for (const l of lines) {
    if (covered(l.date) || !(l.tds > 0)) continue;
    const month = l.date.slice(0, 7);
    const k = `${month}|${l.headKey ?? ""}`;
    const g = groups.get(k) ?? { obligationId: null, period: `${month} (no deposit item)`, periodStart: `${month}-01`, periodEnd: `${month}-31`, headKey: l.headKey, heading: nameOf(l.headKey), withheld: 0, deposited: 0, remaining: 0, status: "no_item" as const, fine: null };
    g.withheld = round2(g.withheld + l.tds);
    g.remaining = g.withheld;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}
