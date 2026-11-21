// Pure calendar-aware occurrence date math for recurring expenses — no database
// import here, deliberately, so this file is safe to import from a CLIENT
// component too (the live "Recurrence Preview" on the create/edit form uses it
// directly, without a round-trip to the server). CRUD lives in ./index.ts.
import { addDays, addMonths, daysInMonth, isoFromYmd, ymdOf, monthRange, monthLabel, filingDueDate, type CalendarSystem, type IsoDate } from "@/lib/calendar";

export type RecurringFrequency = "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";
export type RecognitionRule = "first_day" | "last_day" | "specific_day";
export type DueRule = "same_day" | "specific_day_same_month" | "specific_day_following_month" | "days_after_recognition";
export type RecurringPriority = "critical" | "high" | "normal" | "low";
export type RecurringStatus = "active" | "paused" | "stopped";

/** Months between occurrences for each fixed frequency — "custom" instead takes the
 * user's own interval. One code path in the generation engine covers every frequency. */
export const INTERVAL_MONTHS_BY_FREQUENCY: Record<Exclude<RecurringFrequency, "custom">, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export function intervalMonthsFor(frequency: RecurringFrequency, customIntervalMonths: number): number {
  return frequency === "custom" ? customIntervalMonths : INTERVAL_MONTHS_BY_FREQUENCY[frequency];
}

// Every function below goes through the same CalendarService the rest of the
// app uses (src/lib/calendar/service.ts) so a BS organization's "last day of
// the month" is a real BS month-end, never a Gregorian one — see CLAUDE.md's
// "never duplicate date math elsewhere" rule.

function clampDay(calendar: CalendarSystem, year: number, month: number, day: number): number {
  const dim = daysInMonth(calendar, year, month) ?? day;
  return Math.min(Math.max(day, 1), dim);
}

/** `anchorMonthIso` is any date in the occurrence's period — only its month/year matter. */
export function computeRecognitionDate(calendar: CalendarSystem, anchorMonthIso: IsoDate, rule: RecognitionRule, day: number | null): IsoDate {
  const range = monthRange(calendar, anchorMonthIso);
  if (rule === "first_day") return range.from;
  if (rule === "last_day") return range.to;
  const ymd = ymdOf(calendar, range.from)!;
  return isoFromYmd(calendar, { ...ymd, day: clampDay(calendar, ymd.year, ymd.month, day ?? 1) }) ?? range.from;
}

export function computeDueDate(calendar: CalendarSystem, recognitionDate: IsoDate, rule: DueRule, value: number | null): IsoDate {
  if (rule === "same_day") return recognitionDate;
  const cal: CalendarSystem = ymdOf(calendar, recognitionDate) ? calendar : "AD";
  const ymd = ymdOf(cal, recognitionDate)!;
  if (rule === "specific_day_same_month") return isoFromYmd(cal, { ...ymd, day: clampDay(cal, ymd.year, ymd.month, value ?? ymd.day) }) ?? recognitionDate;
  if (rule === "specific_day_following_month") return filingDueDate(cal, recognitionDate, value ?? 25);
  return addDays(recognitionDate, value ?? 0); // days_after_recognition
}

export function periodKeyAndLabel(calendar: CalendarSystem, anchorMonthIso: IsoDate): { periodKey: string; periodLabel: string } {
  const cal: CalendarSystem = ymdOf(calendar, anchorMonthIso) ? calendar : "AD";
  const ymd = ymdOf(cal, anchorMonthIso)!;
  return { periodKey: `${cal}:${ymd.year}-${String(ymd.month).padStart(2, "0")}`, periodLabel: monthLabel(cal, anchorMonthIso) };
}

/**
 * The next occurrence that has not happened yet: the first one on or after `fromIso` (today), walking the same months the engine schedules from the
 * effective date. Null when the schedule has ended (past its end date or stop date). Unlike previewNextOccurrence, this takes what has already passed into account.
 */
export function nextOccurrenceFrom(input: {
  calendar: CalendarSystem;
  effectiveFrom: IsoDate;
  intervalMonths: number;
  recognitionRule: RecognitionRule;
  recognitionDay: number | null;
  dueRule: DueRule;
  dueRuleValue: number | null;
  endDate: IsoDate | null;
  stoppedEffectiveDate: IsoDate | null;
  fromIso: IsoDate;
}): RecurrencePreview | null {
  let anchor = monthRange(input.calendar, input.effectiveFrom).from;
  for (let i = 0; i < 1200; i++) {
    const expenseDate = computeRecognitionDate(input.calendar, anchor, input.recognitionRule, input.recognitionDay);
    if (input.endDate && expenseDate > input.endDate) return null;
    if (input.stoppedEffectiveDate && expenseDate >= input.stoppedEffectiveDate) return null;
    if (expenseDate >= input.effectiveFrom && expenseDate >= input.fromIso) {
      const { periodKey, periodLabel } = periodKeyAndLabel(input.calendar, anchor);
      return { periodKey, periodLabel, expenseDate, dueDate: computeDueDate(input.calendar, expenseDate, input.dueRule, input.dueRuleValue) };
    }
    anchor = addMonths(input.calendar, anchor, Math.max(input.intervalMonths, 1));
  }
  return null;
}

export type RecurrencePreview = { periodKey: string; periodLabel: string; expenseDate: IsoDate; dueDate: IsoDate };

/** The live "Recurrence Preview" panel on the create/edit form — the very first occurrence a
 * save of this configuration would schedule, computed with the same functions the (Phase 2)
 * generation engine will use, so the preview can never drift from what actually gets generated. */
export function previewNextOccurrence(input: {
  calendar: CalendarSystem;
  startDate: IsoDate;
  recognitionRule: RecognitionRule;
  recognitionDay: number | null;
  dueRule: DueRule;
  dueRuleValue: number | null;
}): RecurrencePreview {
  const anchor = monthRange(input.calendar, input.startDate).from;
  const { periodKey, periodLabel } = periodKeyAndLabel(input.calendar, anchor);
  const expenseDate = computeRecognitionDate(input.calendar, anchor, input.recognitionRule, input.recognitionDay);
  const dueDate = computeDueDate(input.calendar, expenseDate, input.dueRule, input.dueRuleValue);
  return { periodKey, periodLabel, expenseDate, dueDate };
}
