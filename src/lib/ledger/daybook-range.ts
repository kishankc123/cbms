import { addDays } from "@/lib/calendar";
import { buildDaybook, type CashAccount, type DayEntry, type Daybook } from "./daybook-rules";

// The Daybook over a stretch of days: one row for every day, and the whole stretch added up the same way a single day is. Pure, like daybook-rules.ts.

export const MAX_RANGE_DAYS = 93;

export type RangeEntry = DayEntry & { date: string };
export type RangeDay = { day: string; sales: number; purchases: number; expenses: number; moneyIn: number; moneyOut: number; closing: number; /** nothing was entered on this day */ quiet: boolean };
export type DaybookRange = { from: string; to: string; days: RangeDay[]; total: Daybook; busiest: { day: string; sales: number } | null };

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Clamps a requested range: from never after to, and no more than MAX_RANGE_DAYS days. */
export function clampRange(from: string, to: string): { from: string; to: string; trimmed: boolean } {
  const start = from > to ? to : from;
  const days = datesBetween(start, to);
  if (days.length > MAX_RANGE_DAYS) return { from: addDays(to, -(MAX_RANGE_DAYS - 1)), to, trimmed: true };
  return { from: start, to, trimmed: false };
}

export function buildRange(input: { from: string; to: string; entries: RangeEntry[]; cashAccounts: CashAccount[]; /** each account's balance at the end of the day before `from` */ openingBefore: Record<string, number> }): DaybookRange {
  const byDay = new Map<string, RangeEntry[]>();
  for (const e of input.entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  // Every day's opening is the one before it plus what moved, so the rows join up and the last closing is the true balance.
  const running: Record<string, number> = { ...input.openingBefore };
  const days: RangeDay[] = [];
  for (const day of datesBetween(input.from, input.to)) {
    const entries = byDay.get(day) ?? [];
    const opening = { ...running };
    for (const e of entries) for (const l of e.lines) running[l.accountId] = Math.round(((running[l.accountId] ?? 0) + l.debit - l.credit) * 100) / 100;
    const d = buildDaybook({ day, entries, cashAccounts: input.cashAccounts, opening, closing: { ...running } });
    days.push({ day, sales: d.sales.total, purchases: d.purchases.total, expenses: d.expenses.total, moneyIn: d.moneyIn, moneyOut: d.moneyOut, closing: d.totals.closing, quiet: entries.length === 0 });
  }

  // The whole stretch as one: an entry and its undo inside it cancel, even when they were made on different days.
  const total = buildDaybook({ day: input.to, entries: input.entries, cashAccounts: input.cashAccounts, opening: input.openingBefore, closing: running });
  const best = days.reduce<RangeDay | null>((b, d) => (d.sales > 0 && (!b || d.sales > b.sales) ? d : b), null);
  return { from: input.from, to: input.to, days, total, busiest: best ? { day: best.day, sales: best.sales } : null };
}
