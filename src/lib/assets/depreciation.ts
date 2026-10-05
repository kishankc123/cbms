import { addMonths, monthLabel, monthRange, type CalendarSystem, type IsoDate } from "@/lib/calendar";

// Accounting (book) depreciation, as pure functions with no database. Month boundaries come from the central
// calendar service, so a Nepali (BS) organization depreciates by Shrawan, Bhadra ... and an AD one by calendar month.
// A country's TAX depreciation is a separate calculation and never goes through here.

export type DepreciationMethod = "straight_line" | "declining_balance" | "none";

export type SchedulePeriod = {
  /** 1-based position in the schedule. */
  number: number;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  label: string;
  /** Net book value at the start of the period. */
  opening: number;
  depreciation: number;
  /** Net book value at the end of the period. */
  closing: number;
};

/** Declining balance depreciates the opening net book value by this multiple of the straight-line rate. */
export const DECLINING_BALANCE_FACTOR = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What is left to depreciate: cost, less the residual value, less depreciation already taken. Never negative. */
export function depreciableAmount(cost: number, residual: number, accumulatedBefore = 0): number {
  return Math.max(0, round2(cost - residual - accumulatedBefore));
}

export type ScheduleInput = {
  cost: number;
  residual: number;
  /** Depreciation already taken before the schedule starts (opening assets). */
  accumulatedBefore?: number;
  method: DepreciationMethod;
  /** Months to depreciate over, counted from the month containing `startDate`. */
  months: number | null;
  startDate: IsoDate;
  calendar: CalendarSystem;
};

/**
 * The full month-by-month schedule. The first period is the month that contains the start date (a whole month), and
 * the depreciation always adds up to exactly the depreciable amount: the last period absorbs any rounding, and the
 * net book value never falls below the residual value.
 */
export function depreciationSchedule(input: ScheduleInput): SchedulePeriod[] {
  const { cost, residual, method, startDate, calendar } = input;
  const months = input.months ?? 0;
  const accumulatedBefore = input.accumulatedBefore ?? 0;
  const total = depreciableAmount(cost, residual, accumulatedBefore);
  if (method === "none" || !Number.isInteger(months) || months < 1 || total <= 0) return [];

  const rows: SchedulePeriod[] = [];
  let opening = round2(cost - accumulatedBefore);
  let taken = 0;
  const monthlyRate = DECLINING_BALANCE_FACTOR / months;

  for (let i = 0; i < months; i++) {
    const remaining = round2(total - taken);
    let depreciation: number;
    if (i === months - 1) depreciation = remaining;
    else if (method === "straight_line") depreciation = Math.min(round2(total / months), remaining);
    else depreciation = Math.min(round2(opening * monthlyRate), remaining);
    if (depreciation <= 0) break;

    const anchor = addMonths(calendar, startDate, i);
    const range = monthRange(calendar, anchor);
    const closing = round2(opening - depreciation);
    rows.push({ number: i + 1, periodStart: range.from, periodEnd: range.to, label: monthLabel(calendar, anchor), opening, depreciation, closing });
    taken = round2(taken + depreciation);
    opening = closing;
  }
  return rows;
}

/** A single month's depreciation for display (the first period's), or 0 when the asset isn't depreciated. */
export function firstPeriodDepreciation(input: ScheduleInput): number {
  return depreciationSchedule(input)[0]?.depreciation ?? 0;
}
