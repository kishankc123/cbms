import {
  addDays,
  addMonths,
  bsFiscalYearOf,
  daysInMonth,
  isoFromYmd,
  monthLabel,
  monthNames,
  monthRange,
  yearRange,
  ymdOf,
  type CalendarSystem,
  type DateRange,
  type IsoDate,
} from "@/lib/calendar";

// Due-date rules and the periods they apply to. Everything goes through the
// central CalendarService, so "the 25th of the following month" is a BS month
// for a BS-counted requirement and a Gregorian one otherwise; the result is
// always a real AD date, which is all that is ever stored or compared.

// "event": not a recurring period — one obligation raised when something happens (a shareholder
// change), due `daysAfterEnd` days after the event date. Periods for it are built by the caller.
export type PeriodKind = "month" | "quarter" | "fiscal_year" | "event";

export type DueRule = {
  period: PeriodKind;
  /** Shift the period's end by this many months (default 0)... */
  monthsAfterEnd?: number;
  /** ...and land on this day of that month ("last" = its last day). Default: the end's own day, clamped. */
  dayOfMonth?: number | "last";
  /** Alternative: a plain number of days after the period end. */
  daysAfterEnd?: number;
};

export type Period = { key: string; label: string; start: IsoDate; end: IsoDate };

export type PeriodContext = {
  calendar: CalendarSystem;
  today: IsoDate;
  /** The organization's configured fiscal year, when it has one covering `today`. */
  fiscal: DateRange | null;
};

export function assertValidDueRule(r: unknown): asserts r is DueRule {
  if (typeof r !== "object" || r === null) throw new Error("dueRule: expected an object");
  const o = r as Record<string, unknown>;
  if (o.period !== "month" && o.period !== "quarter" && o.period !== "fiscal_year" && o.period !== "event") throw new Error(`dueRule: unknown period "${String(o.period)}"`);
  for (const k of ["monthsAfterEnd", "daysAfterEnd"]) {
    if (o[k] !== undefined && (typeof o[k] !== "number" || !Number.isInteger(o[k]) || (o[k] as number) < 0)) throw new Error(`dueRule: "${k}" must be a non-negative integer`);
  }
  if (o.period === "event" && o.daysAfterEnd === undefined) throw new Error('dueRule: an "event" rule needs "daysAfterEnd"');
  if (o.dayOfMonth !== undefined && o.dayOfMonth !== "last" && (typeof o.dayOfMonth !== "number" || o.dayOfMonth < 1 || o.dayOfMonth > 32)) {
    throw new Error('dueRule: "dayOfMonth" must be 1-32 or "last"');
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function computeDueDate(rule: DueRule, period: Period, calendar: CalendarSystem): IsoDate {
  if (rule.daysAfterEnd !== undefined) return addDays(period.end, rule.daysAfterEnd);
  const cal: CalendarSystem = ymdOf(calendar, period.end) ? calendar : "AD";
  const end = ymdOf(cal, period.end)!;
  const target = ymdOf(cal, addMonths(cal, period.end, rule.monthsAfterEnd ?? 0))!;
  const dim = daysInMonth(cal, target.year, target.month)!;
  const day = rule.dayOfMonth === undefined ? Math.min(end.day, dim) : rule.dayOfMonth === "last" ? dim : Math.min(rule.dayOfMonth, dim);
  return isoFromYmd(cal, { ...target, day }) ?? period.end;
}

// ---------------------------------------------------------------- periods

function fiscalBase(ctx: PeriodContext): DateRange {
  if (ctx.fiscal && ctx.fiscal.from <= ctx.today && ctx.today <= ctx.fiscal.to) return ctx.fiscal;
  if (ctx.calendar === "BS") {
    const fy = bsFiscalYearOf(ctx.today);
    if (fy) return { from: fy.from, to: fy.to };
  }
  return yearRange("AD", ctx.today);
}

function fiscalLabel(cal: CalendarSystem, start: IsoDate): string {
  const ymd = ymdOf(cal, start) ?? ymdOf("AD", start)!;
  return ymd.month === 1 ? `FY ${ymd.year}` : `FY ${ymd.year}/${pad2((ymd.year + 1) % 100)}`;
}

/**
 * Periods of the given kind around `today`: `back` before the current one and
 * `ahead` after it (fiscal years only look back — next year's return is not
 * yet a thing to do).
 */
export function periodsFor(kind: PeriodKind, ctx: PeriodContext, back: number, ahead: number): Period[] {
  const cal = ctx.calendar;
  const out: Period[] = [];
  if (kind === "event") return out;

  if (kind === "month") {
    for (let d = -back; d <= ahead; d++) {
      const anchor = addMonths(cal, ctx.today, d);
      const c: CalendarSystem = ymdOf(cal, anchor) ? cal : "AD";
      const y = ymdOf(c, anchor)!;
      const r = monthRange(c, anchor);
      out.push({ key: `M:${c}:${y.year}-${pad2(y.month)}`, label: monthLabel(c, anchor), start: r.from, end: r.to });
    }
    return out;
  }

  const base = fiscalBase(ctx);
  const baseStart = ymdOf(cal, base.from) ?? ymdOf("AD", base.from)!;

  if (kind === "quarter") {
    // Quarters are 3-month blocks counted from the fiscal year's first month.
    const startMonth = baseStart.month;
    const now = ymdOf(cal, ctx.today)!;
    const idx = (((now.month - startMonth) % 12) + 12) % 12;
    const qFirstMonth = ((startMonth - 1 + Math.floor(idx / 3) * 3) % 12) + 1;
    const qFirstYear = qFirstMonth > now.month ? now.year - 1 : now.year;
    const qStart = isoFromYmd(cal, { year: qFirstYear, month: qFirstMonth, day: 1 })!;
    for (let d = -back; d <= ahead; d++) {
      const s = addMonths(cal, qStart, 3 * d);
      const nextS = addMonths(cal, qStart, 3 * (d + 1));
      const sy = ymdOf(cal, s)!;
      const e = addDays(nextS, -1);
      const ey = ymdOf(cal, e)!;
      const names = monthNames(cal);
      out.push({ key: `Q:${cal}:${sy.year}-${pad2(sy.month)}`, label: `${names[sy.month - 1]}–${names[ey.month - 1]} ${ey.year}`, start: s, end: e });
    }
    return out;
  }

  // fiscal_year
  for (let d = -back; d <= Math.min(ahead, 0); d++) {
    const start = d === 0 ? base.from : addMonths(cal, base.from, 12 * d);
    const end = d === 0 ? base.to : addDays(addMonths(cal, base.from, 12 * (d + 1)), -1);
    out.push({ key: `FY:${start}`, label: fiscalLabel(cal, start), start, end });
  }
  return out;
}
