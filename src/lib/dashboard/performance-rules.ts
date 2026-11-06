// The numbers behind the Overview's Revenue, Cost of goods sold, Expenses and Profitability: for a period, the same figures for the period
// before and for the same period a year ago, a month-by-month history, and a plain expectation for the next three months drawn from that history.
// Pure (no database): the loader (performance.ts) supplies one row per day with its revenue, cost of goods sold and other expenses.

import { addDays, daysInMonth, isoFromYmd, monthRange, ymdOf, type CalendarSystem } from "@/lib/calendar";
import { bucketOf } from "./cash-flow-rules";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type DayAmounts = { day: string; revenue: number; cogs: number; expenses: number };
export type Totals = { revenue: number; cogs: number; expenses: number; gross: number; net: number };

export const emptyTotals = (): Totals => ({ revenue: 0, cogs: 0, expenses: 0, gross: 0, net: 0 });

/** What a period came to: revenue, cost of goods sold, other expenses, gross profit (revenue less cost of goods sold) and net profit. */
export function totalsOf(rows: DayAmounts[], from: string, to: string): Totals {
  let revenue = 0;
  let cogs = 0;
  let expenses = 0;
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    revenue += r.revenue;
    cogs += r.cogs;
    expenses += r.expenses;
  }
  return { revenue: round2(revenue), cogs: round2(cogs), expenses: round2(expenses), gross: round2(revenue - cogs), net: round2(revenue - cogs - expenses) };
}

const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000);

/** The period of the same length that ends the day before this one starts (a month is compared with the month before, a year with the year before). */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(length - 1)), to: prevTo };
}

/** The same day a year earlier in the organization's own calendar (a day that does not exist then, such as 29 February, becomes the month's last day). */
function yearEarlier(calendar: CalendarSystem, iso: string): string {
  const cal: CalendarSystem = ymdOf(calendar, iso) ? calendar : "AD";
  const ymd = ymdOf(cal, iso);
  if (!ymd) return iso;
  const year = ymd.year - 1;
  const last = daysInMonth(cal, year, ymd.month) ?? ymd.day;
  return isoFromYmd(cal, { year, month: ymd.month, day: Math.min(ymd.day, last) }) ?? iso;
}

/** The same period a year earlier, in the organization's own calendar (a BS organization compares Shrawan with Shrawan). */
export function lastYearRange(from: string, to: string, calendar: CalendarSystem): { from: string; to: string } {
  return { from: yearEarlier(calendar, from), to: yearEarlier(calendar, to) };
}

export type Kind = "income" | "cost";
export type Change = {
  /** The comparison figure. */
  value: number;
  /** How far the current figure is from it, in percent of the comparison. null when the comparison is zero, so no percentage can be given. */
  pct: number | null;
  direction: "up" | "down" | "flat";
  /** Up is good for revenue and profit; down is good for costs. null when nothing changed or there is no comparison to judge by. */
  good: boolean | null;
};

export function changeOf(current: number, comparison: number, kind: Kind): Change {
  const diff = round2(current - comparison);
  const direction = Math.abs(diff) < 0.005 ? "flat" : diff > 0 ? "up" : "down";
  const pct = Math.abs(comparison) < 0.005 ? null : round2((diff / Math.abs(comparison)) * 100);
  const good = direction === "flat" || Math.abs(comparison) < 0.005 ? null : kind === "income" ? direction === "up" : direction === "down";
  return { value: round2(comparison), pct, direction, good };
}

export type MonthPoint = { key: string; label: string; from: string; to: string; revenue: number; cogs: number; expenses: number; gross: number; net: number; /** The month has not finished yet. */ partial: boolean };

/**
 * The last `count` months up to the one holding `anchor` (the end of the period, or today if that is earlier), each with its totals. Months follow
 * the organization's calendar. The newest month is marked partial while it is still running, so it can be shown but kept out of the expectation.
 */
export function monthlySeries(rows: DayAmounts[], anchor: string, count: number, calendar: CalendarSystem): MonthPoint[] {
  const out: MonthPoint[] = [];
  let cursor = anchor;
  for (let i = 0; i < count; i++) {
    const m = monthRange(calendar, cursor);
    const b = bucketOf(m.from, "month", calendar);
    const t = totalsOf(rows, m.from, m.to);
    out.unshift({ key: b.key, label: b.label, from: m.from, to: m.to, ...t, partial: m.to > anchor });
    cursor = addDays(m.from, -1);
  }
  return out;
}

export type Projection = {
  months: number;
  /** How many finished months it was drawn from. */
  basis: number;
  perMonth: number;
  expected: number;
  /** A fair range around the expectation: one typical month-to-month swing either side. */
  low: number;
  high: number;
};

const MIN_MONTHS = 6;
const MAX_MONTHS = 12;

/**
 * A plain expectation for the next `months` months: what an average finished month has brought in over the last year (or what history there
 * is), with a range of one typical swing either side. It is a rule of thumb, not a forecast model; with fewer than six finished months it says
 * nothing rather than guess (null).
 */
export function project(finishedMonths: number[], months = 3, nonNegative = true): Projection | null {
  const history = finishedMonths.slice(-MAX_MONTHS);
  if (history.length < MIN_MONTHS) return null;
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / (history.length - 1);
  const sd = Math.sqrt(variance);
  const clamp = (n: number) => round2(nonNegative ? Math.max(n, 0) : n);
  return { months, basis: history.length, perMonth: round2(mean), expected: clamp(mean * months), low: clamp((mean - sd) * months), high: clamp((mean + sd) * months) };
}

export type PerformanceView = {
  range: { from: string; to: string };
  current: Totals;
  previous: { range: { from: string; to: string }; totals: Totals };
  lastYear: { range: { from: string; to: string }; totals: Totals };
  changes: { previous: Record<keyof Totals, Change>; lastYear: Record<keyof Totals, Change> };
  series: MonthPoint[];
  /** Expectation for the next months, by heading. null for a heading with too little history. */
  projection: { revenue: Projection | null; cogs: Projection | null; expenses: Projection | null; net: Projection | null; gross: Projection | null };
  /** The next months being expected, named in the organization's calendar. */
  nextMonths: { label: string }[];
};

const KINDS: Record<keyof Totals, Kind> = { revenue: "income", cogs: "cost", expenses: "cost", gross: "income", net: "income" };

export function buildPerformance(input: { rows: DayAmounts[]; from: string; to: string; today: string; calendar: CalendarSystem; historyMonths?: number; projectMonths?: number }): PerformanceView {
  const { rows, from, to, today, calendar } = input;
  const historyMonths = input.historyMonths ?? 12;
  const projectMonths = input.projectMonths ?? 3;
  const anchor = to < today ? to : today;
  const prevRange = previousRange(from, to);
  const yearRange = lastYearRange(from, to, calendar);
  const current = totalsOf(rows, from, to);
  const prev = totalsOf(rows, prevRange.from, prevRange.to);
  const year = totalsOf(rows, yearRange.from, yearRange.to);
  const compare = (other: Totals) => Object.fromEntries((Object.keys(KINDS) as (keyof Totals)[]).map((k) => [k, changeOf(current[k], other[k], KINDS[k])])) as Record<keyof Totals, Change>;

  // The chart shows a full year of months; the expectation uses only the months that have finished.
  const series = monthlySeries(rows, anchor, Math.max(historyMonths, MAX_MONTHS), calendar);
  // History starts with the first month that had any activity: months before the business began are not "zero months" to average over.
  const firstActive = series.findIndex((m) => m.revenue !== 0 || m.cogs !== 0 || m.expenses !== 0);
  const finished = firstActive < 0 ? [] : series.slice(firstActive).filter((m) => !m.partial);
  const of = (pick: (m: MonthPoint) => number, nonNegative: boolean) => project(finished.map(pick), projectMonths, nonNegative);

  const nextMonths: { label: string }[] = [];
  let cursor = monthRange(calendar, anchor).to;
  for (let i = 0; i < projectMonths; i++) {
    cursor = addDays(cursor, 1);
    nextMonths.push({ label: bucketOf(cursor, "month", calendar).label });
    cursor = monthRange(calendar, cursor).to;
  }

  return {
    range: { from, to },
    current,
    previous: { range: prevRange, totals: prev },
    lastYear: { range: yearRange, totals: year },
    changes: { previous: compare(prev), lastYear: compare(year) },
    series: series.slice(-historyMonths),
    projection: { revenue: of((m) => m.revenue, true), cogs: of((m) => m.cogs, true), expenses: of((m) => m.expenses, true), net: of((m) => m.net, false), gross: of((m) => m.gross, false) },
    nextMonths,
  };
}
