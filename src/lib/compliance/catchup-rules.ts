import { addDays, bsFiscalYearOf, bsFiscalYearRange, isoFromYmd, monthLabel, monthRange, type IsoDate } from "@/lib/calendar";

// The catch-up checklist: for each kind of requirement ("stream"), what was already filed when the organization started using
// the system. The answer is the end of the last period filed; every period up to it is marked filed, every later one is owed.
// Pure: no database.

export type StreamKey = "income_tax" | "vat" | "tds" | "excise_return" | "excise_permit";
/** "year" = a fiscal year, "month" = a BS month, "term" = a four-month VAT term, "permit" = a fiscal year of the excise permit. */
export type StreamKind = "year" | "month" | "term" | "permit";

export const STREAM_LABEL: Record<StreamKey, string> = {
  income_tax: "Annual income tax return",
  vat: "VAT returns",
  tds: "TDS deposits",
  excise_return: "Excise returns",
  excise_permit: "Excise permit renewal",
};
export const STREAM_ORDER: StreamKey[] = ["income_tax", "vat", "tds", "excise_return", "excise_permit"];

/** The requirement template each stream is generated from. */
export const TEMPLATE_STREAM: Record<string, StreamKey> = {
  income_tax_return: "income_tax",
  vat_return: "vat",
  vat_return_quarterly: "vat",
  tds_deposit: "tds",
  excise_return: "excise_return",
};

export type PeriodOption = { /** The end date of the last period filed. */ value: IsoDate; label: string };

const SAFETY = 400;

/** The fiscal years from the one containing `from` through the last finished one (or the current one, for the permit). */
function fiscalYears(from: IsoDate, today: IsoDate, includeCurrent: boolean): PeriodOption[] {
  const first = bsFiscalYearOf(from)?.startYear;
  const current = bsFiscalYearOf(today)?.startYear;
  if (first === undefined || current === undefined) return [];
  const out: PeriodOption[] = [];
  for (let y = first; y <= (includeCurrent ? current : current - 1); y++) {
    const r = bsFiscalYearRange(y);
    if (r) out.push({ value: r.to, label: `FY ${r.label}` });
  }
  return out;
}

/** BS months from the month containing `from` through the last completed month. */
function months(from: IsoDate, today: IsoDate): PeriodOption[] {
  const out: PeriodOption[] = [];
  let anchor = monthRange("BS", from).from;
  for (let i = 0; i < SAFETY; i++) {
    const r = monthRange("BS", anchor);
    if (r.to >= today) break;
    out.push({ value: r.to, label: monthLabel("BS", r.from) });
    anchor = addDays(r.to, 1);
  }
  return out;
}

const TERM_NAMES = ["Shrawan–Kartik", "Mangsir–Falgun", "Chaitra–Ashad"];

/** VAT terms (Shrawan–Kartik, Mangsir–Falgun, Chaitra–Ashad) from the one containing `from` through the last completed. */
function terms(from: IsoDate, today: IsoDate): PeriodOption[] {
  const first = bsFiscalYearOf(from)?.startYear;
  const current = bsFiscalYearOf(today)?.startYear;
  if (first === undefined || current === undefined) return [];
  const out: PeriodOption[] = [];
  for (let y = first; y <= current; y++) {
    const starts = [isoFromYmd("BS", { year: y, month: 4, day: 1 }), isoFromYmd("BS", { year: y, month: 8, day: 1 }), isoFromYmd("BS", { year: y, month: 12, day: 1 })];
    const ends = [starts[1] && addDays(starts[1], -1), starts[2] && addDays(starts[2], -1), bsFiscalYearRange(y)?.to];
    for (let t = 0; t < 3; t++) {
      const end = ends[t];
      if (!end || end >= today || end < from) continue;
      out.push({ value: end, label: `${TERM_NAMES[t]} ${y}` });
    }
  }
  return out;
}

/** What the person can choose as "filed up to", oldest first, for a stream that starts on `from`. Nothing is offered that is not yet over. */
export function periodOptions(kind: StreamKind, from: IsoDate, today: IsoDate): PeriodOption[] {
  switch (kind) {
    case "year":
      return fiscalYears(from, today, false);
    case "permit":
      return fiscalYears(from, today, true);
    case "month":
      return months(from, today);
    case "term":
      return terms(from, today);
  }
}

/**
 * The answer to start from, given what was said about income tax: when the income tax return is filed through the latest
 * finished fiscal year, every other stream is pre-selected through that same date (the end of Ashadh), for the person to confirm.
 * null = none filed yet (also when the stream began after that date, so nothing was due).
 */
export function prefillFrom(incomeTaxThrough: IsoDate | null, latestFinishedYearEnd: IsoDate | null, options: PeriodOption[]): IsoDate | null {
  if (!incomeTaxThrough || !latestFinishedYearEnd || incomeTaxThrough !== latestFinishedYearEnd) return null;
  return options.some((o) => o.value === latestFinishedYearEnd) ? latestFinishedYearEnd : null;
}

/** The end of the latest fiscal year that has finished before `today`. */
export function latestFinishedYearEnd(today: IsoDate): IsoDate | null {
  const current = bsFiscalYearOf(today)?.startYear;
  return current === undefined ? null : bsFiscalYearRange(current - 1)?.to ?? null;
}

/** An answer is valid when it is "none" or one of the offered periods. */
export function answerValid(options: PeriodOption[], value: IsoDate | null): boolean {
  return value === null || options.some((o) => o.value === value);
}

/** Whether a period (by its end date) was filed before the system, given the answer for its stream. */
export function filedBefore(periodEnd: IsoDate | null, filedThrough: IsoDate | null): boolean {
  return Boolean(periodEnd && filedThrough && periodEnd <= filedThrough);
}
