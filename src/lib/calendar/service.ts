// CalendarService — the ONE place AD <-> BS conversion, formatting, parsing,
// detection and range logic lives. Every module (pickers, tables, reports,
// imports, exports, periods, payroll) goes through here.
//
// Rule: the canonical form of every business date is an AD ISO string
// "YYYY-MM-DD". BS exists only for entering, showing and reporting; nothing
// is ever calculated or compared using a BS value.
import {
  BS_MIN_YEAR,
  BS_MAX_YEAR,
  VERIFIED_THROUGH_BS_YEAR,
  BS_RANGE_START_UTC,
  BS_RANGE_END_UTC,
  bsDaysInMonth,
  adUtcToBs,
  bsToAdUtc,
} from "./bs-data";

export type CalendarSystem = "AD" | "BS";
export type IsoDate = string;
export type YMD = { year: number; month: number; day: number };
export type DateStyle = "numeric" | "long" | "short";

export const AD_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
export const WEEKDAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

export const monthNames = (calendar: CalendarSystem) => (calendar === "BS" ? BS_MONTHS : AD_MONTHS);

// ---------------------------------------------------------------- basics

export function isoOfYmd({ year, month, day }: YMD): IsoDate {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

function utcOfIso(iso: IsoDate): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

const isoOfUtc = (t: number): IsoDate => new Date(t).toISOString().slice(0, 10);

export const validateADDate = (iso: string): boolean => utcOfIso(iso) !== null;

export function adDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Business "today" in Nepal time (UTC+5:45) — never the server's UTC date. */
export function todayIso(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function weekdayOf(iso: IsoDate): number {
  const t = utcOfIso(iso);
  return t === null ? 0 : new Date(t).getUTCDay();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const t = utcOfIso(iso);
  if (t === null) return iso;
  return isoOfUtc(t + days * DAY_MS);
}

// ------------------------------------------------------------ conversion

export function convertADtoBS(iso: IsoDate): YMD | null {
  const t = utcOfIso(iso);
  return t === null ? null : adUtcToBs(t);
}

export function convertBStoAD(bs: YMD): IsoDate | null {
  const t = bsToAdUtc(bs.year, bs.month, bs.day);
  return t === null ? null : isoOfUtc(t);
}

export function validateBSDate(bs: YMD): boolean {
  return bsToAdUtc(bs.year, bs.month, bs.day) !== null;
}

export function ymdOf(calendar: CalendarSystem, iso: IsoDate): YMD | null {
  if (calendar === "BS") return convertADtoBS(iso);
  const t = utcOfIso(iso);
  if (t === null) return null;
  const d = new Date(t);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function isoFromYmd(calendar: CalendarSystem, ymd: YMD): IsoDate | null {
  if (calendar === "BS") return convertBStoAD(ymd);
  return validateADDate(isoOfYmd(ymd)) ? isoOfYmd(ymd) : null;
}

export function daysInMonth(calendar: CalendarSystem, year: number, month: number): number | null {
  return calendar === "BS" ? bsDaysInMonth(year, month) : adDaysInMonth(year, month);
}

/** True when a BS date is past the years all our data sources agree on. */
export function isProjectedBs(iso: IsoDate): boolean {
  const bs = convertADtoBS(iso);
  return bs !== null && bs.year > VERIFIED_THROUGH_BS_YEAR;
}

export function dataStatus() {
  return {
    bsMinYear: BS_MIN_YEAR,
    bsMaxYear: BS_MAX_YEAR,
    verifiedThroughBsYear: VERIFIED_THROUGH_BS_YEAR,
    adMin: isoOfUtc(BS_RANGE_START_UTC),
    adMax: isoOfUtc(BS_RANGE_END_UTC),
  };
}

// ------------------------------------------------------------ formatting

export function formatDate(iso: IsoDate | null | undefined, calendar: CalendarSystem, style: DateStyle = "numeric"): string {
  if (!iso) return "";
  const ymd = ymdOf(calendar, iso);
  if (!ymd) {
    // Outside the BS table (e.g. beyond AD 2033): fall back to AD so the date is never hidden.
    const ad = ymdOf("AD", iso);
    return ad ? `${formatYmd("AD", ad, style)} AD` : iso;
  }
  return formatYmd(calendar, ymd, style);
}

function formatYmd(calendar: CalendarSystem, { year, month, day }: YMD, style: DateStyle): string {
  if (style === "numeric") return `${pad2(day)}-${pad2(month)}-${pad4(year)}`;
  const name = monthNames(calendar)[month - 1];
  if (style === "short" && calendar === "AD") return `${pad2(day)} ${name.slice(0, 3)} ${year}`;
  return `${pad2(day)} ${name} ${year}`;
}

export const formatAD = (iso: IsoDate | null | undefined, style: DateStyle = "numeric") => formatDate(iso, "AD", style);
export const formatBS = (iso: IsoDate | null | undefined, style: DateStyle = "numeric") => formatDate(iso, "BS", style);

/**
 * Shows a period (periodStart..periodEnd, both AD ISO) in the given calendar — never in
 * whatever calendar it happened to be generated under. A period a whole month in THIS
 * calendar reads as "Bhadra 2083" / "September 2026"; a statutory period that doesn't
 * line up with this calendar's months (e.g. a BS month shown to an AD-calendar
 * organization) reads as its real date range, e.g. "17 Aug – 16 Sep 2026" — so a
 * Nepal filing deadline is never misrepresented as one of the reader's own calendar months.
 */
export function formatPeriodRange(calendar: CalendarSystem, periodStart: IsoDate | null | undefined, periodEnd: IsoDate | null | undefined, fallbackLabel: string): string {
  if (!periodStart || !periodEnd) return fallbackLabel;
  const start = ymdOf(calendar, periodStart);
  const end = ymdOf(calendar, periodEnd);
  if (!start || !end) return fallbackLabel;
  const wholeMonth = start.year === end.year && start.month === end.month && start.day === 1 && end.day === (daysInMonth(calendar, end.year, end.month) ?? -1);
  if (wholeMonth) return `${monthNames(calendar)[start.month - 1]} ${start.year}`;
  return `${formatYmd(calendar, start, "short")} – ${formatYmd(calendar, end, "short")}`;
}

export type DateDisplayMode = "AD" | "BS" | "BOTH";

/** Date + time (Nepal time) for system timestamps such as "created at". */
export function formatDateTime(value: Date | string | null | undefined, calendar: CalendarSystem): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${formatDate(todayIso(d), calendar)} ${parts}`;
}

/** Date column(s) for CSV/Excel exports: AD, BS, or both, from the one stored AD date. */
export function exportDateColumns(mode: DateDisplayMode, iso: IsoDate | null | undefined): string[] {
  const cals: CalendarSystem[] = mode === "BOTH" ? ["AD", "BS"] : [mode];
  return cals.map((c) => formatDate(iso, c));
}

export function exportDateHeaders(mode: DateDisplayMode, label = "Date"): string[] {
  const cals: CalendarSystem[] = mode === "BOTH" ? ["AD", "BS"] : [mode];
  return cals.map((c) => `${label} (${c})`);
}

// --------------------------------------------------------------- parsing

const DEVANAGARI_ZERO = 0x0966;
export function normalizeDigits(s: string): string {
  return s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - DEVANAGARI_ZERO));
}

const BS_MONTH_ALIASES: string[][] = [
  ["baisakh", "baishakh", "vaisakh", "baisak", "बैशाख", "वैशाख"],
  ["jestha", "jeth", "jyestha", "जेठ", "जेष्ठ"],
  ["ashadh", "asar", "ashad", "asadh", "असार", "आषाढ"],
  ["shrawan", "srawan", "sawan", "shravan", "साउन", "श्रावण"],
  ["bhadra", "bhadau", "bhado", "भदौ", "भाद्र"],
  ["ashwin", "aswin", "asoj", "ashoj", "ashwiin", "असोज", "आश्विन"],
  ["kartik", "kartak", "कार्तिक"],
  ["mangsir", "mangshir", "margashirsha", "मंसिर", "मङ्सिर"],
  ["poush", "paush", "push", "पौष"],
  ["magh", "माघ"],
  ["falgun", "phalgun", "fagun", "फाल्गुन", "फागुन"],
  ["chaitra", "chait", "चैत", "चैत्र"],
];

function monthFromName(token: string, calendar: CalendarSystem): number | null {
  const t = token.toLowerCase().replace(/\.$/, "");
  if (calendar === "BS") {
    const idx = BS_MONTH_ALIASES.findIndex((names) => names.includes(t));
    return idx === -1 ? null : idx + 1;
  }
  if (t.length < 3) return null;
  const idx = AD_MONTHS.findIndex((m) => m.toLowerCase().startsWith(t.slice(0, Math.max(3, t.length))) || (t === "sept" && m === "September"));
  return idx === -1 ? null : idx + 1;
}

export type ParseResult =
  | { ok: true; iso: IsoDate; calendar: CalendarSystem; dayMonthAmbiguous: boolean; projected: boolean }
  | { ok: false; error: string };

export type ParseOptions = { dayFirst?: boolean };

/**
 * Parses a user/typed/imported date under a KNOWN calendar into the canonical
 * AD ISO date. Accepts YYYY-MM-DD, DD-MM-YYYY (also with / . or spaces),
 * "20 September 2026", "04 Ashwin 2083", Devanagari digits and month names.
 */
export function parseDate(input: string | null | undefined, calendar: CalendarSystem, opts: ParseOptions = {}): ParseResult {
  if (input == null || String(input).trim() === "") return { ok: false, error: "Enter a date." };
  const dayFirst = opts.dayFirst ?? true;
  let s = normalizeDigits(String(input)).trim();

  // ISO timestamp -> keep just the date
  const isoTs = /^(\d{4}-\d{2}-\d{2})[T ]\d/.exec(s);
  if (isoTs) s = isoTs[1];

  const parts = s.split(/[\s\-/.,]+/).filter(Boolean);
  if (parts.length !== 3) return { ok: false, error: "Use a date like 20-09-2026 or 2026-09-20." };

  const isNum = (p: string) => /^\d+$/.test(p);
  let year: number, month: number, day: number;
  let dayMonthAmbiguous = false;

  const nameIdx = parts.findIndex((p) => !isNum(p));
  if (nameIdx !== -1) {
    const m = monthFromName(parts[nameIdx], calendar);
    if (m === null) return { ok: false, error: `"${parts[nameIdx]}" is not a valid ${calendar === "BS" ? "Nepali" : "English"} month name.` };
    const rest = parts.filter((_, i) => i !== nameIdx);
    if (!rest.every(isNum)) return { ok: false, error: "Unrecognised date." };
    const [a, b] = rest;
    month = m;
    if (a.length === 4) { year = +a; day = +b; } else if (b.length === 4) { year = +b; day = +a; } else return { ok: false, error: "Use a 4-digit year." };
  } else {
    const [a, b, c] = parts;
    if (a.length === 4) { year = +a; month = +b; day = +c; }
    else if (c.length === 4) {
      year = +c;
      if (dayFirst) { day = +a; month = +b; } else { month = +a; day = +b; }
      dayMonthAmbiguous = +a <= 12 && +b <= 12 && +a !== +b;
    } else return { ok: false, error: "Use a 4-digit year." };
  }

  if (calendar === "BS") {
    const iso = convertBStoAD({ year, month, day });
    if (!iso) {
      return { ok: false, error: `${pad2(day)}-${pad2(month)}-${year} is not a valid BS date (supported BS ${BS_MIN_YEAR}–${BS_MAX_YEAR}).` };
    }
    return { ok: true, iso, calendar, dayMonthAmbiguous, projected: year > VERIFIED_THROUGH_BS_YEAR };
  }
  const iso = isoOfYmd({ year, month, day });
  if (!validateADDate(iso)) return { ok: false, error: `${pad2(day)}-${pad2(month)}-${year} is not a valid date.` };
  return { ok: true, iso, calendar, dayMonthAmbiguous, projected: false };
}

// ------------------------------------------------------------- detection

export type RowCalendar = "AD" | "BS" | "ambiguous" | "invalid";
export type RowDetection = {
  index: number;
  raw: string;
  calendar: RowCalendar;
  /** Canonical AD date under the detected calendar (null when ambiguous/invalid). */
  iso: IsoDate | null;
  adIso: IsoDate | null;
  bsIso: IsoDate | null;
  dayMonthAmbiguous: boolean;
  projected: boolean;
  note?: string;
};

export type DetectOptions = { header?: string; dayFirst?: boolean; today?: IsoDate };

const AD_HEADER_HINT = /\b(ad|a\.d\.?|english|gregorian|eng)\b/i;
const BS_HEADER_HINT = /\b(bs|b\.s\.?|nepali|miti|bikram|vs)\b|मिति/i;

export function headerHint(header?: string): CalendarSystem | null {
  if (!header) return null;
  const bs = BS_HEADER_HINT.test(header);
  const ad = AD_HEADER_HINT.test(header);
  if (bs && !ad) return "BS";
  if (ad && !bs) return "AD";
  return null;
}

/**
 * Years that make sense for real accounting data, per calendar: a generous
 * window around today. The AD and BS windows never overlap (BS ≈ AD + 57), so
 * the year alone usually decides, and structural validity (day 32, etc.)
 * backs it up. Anything that fits neither is reported, never guessed.
 */
function plausibleYears(today: IsoDate) {
  const ad = +today.slice(0, 4);
  const bsNow = convertADtoBS(today)?.year ?? ad + 57;
  return { ad: [ad - 30, ad + 8] as const, bs: [bsNow - 30, bsNow + 8] as const };
}

export function classifyDate(raw: string | null | undefined, index: number, opts: DetectOptions = {}): RowDetection {
  const value = raw == null ? "" : String(raw);
  const today = opts.today ?? todayIso();
  const win = plausibleYears(today);
  const asAd = parseDate(value, "AD", { dayFirst: opts.dayFirst });
  const asBs = parseDate(value, "BS", { dayFirst: opts.dayFirst });

  const base = { index, raw: value, adIso: asAd.ok ? asAd.iso : null, bsIso: asBs.ok ? asBs.iso : null };
  const yearOf = (p: ParseResult, cal: CalendarSystem) => (p.ok ? (cal === "AD" ? +p.iso.slice(0, 4) : (convertADtoBS(p.iso)?.year ?? 0)) : 0);
  const inWin = (y: number, w: readonly [number, number]) => y >= w[0] && y <= w[1];

  const adPlausible = asAd.ok && inWin(yearOf(asAd, "AD"), win.ad);
  const bsPlausible = asBs.ok && inWin(yearOf(asBs, "BS"), win.bs);

  const pick = (cal: CalendarSystem, note?: string): RowDetection => {
    const p = cal === "AD" ? asAd : asBs;
    return { ...base, calendar: cal, iso: p.ok ? p.iso : null, dayMonthAmbiguous: p.ok ? p.dayMonthAmbiguous : false, projected: p.ok ? p.projected : false, note };
  };

  if (!asAd.ok && !asBs.ok) {
    return { ...base, calendar: "invalid", iso: null, dayMonthAmbiguous: false, projected: false, note: value.trim() === "" ? "Empty date" : (asAd.ok ? "" : asAd.error) };
  }
  if (asAd.ok && !asBs.ok) return pick("AD");
  if (asBs.ok && !asAd.ok) return pick("BS");

  if (adPlausible && !bsPlausible) return pick("AD");
  if (bsPlausible && !adPlausible) return pick("BS");

  const hint = headerHint(opts.header);
  if (hint) return pick(hint, "Chosen from the column header");
  return { ...base, calendar: "ambiguous", iso: null, dayMonthAmbiguous: false, projected: false, note: "Could be AD or BS — please choose" };
}

export type Detection = {
  /** "none" = no dates found. */
  calendar: CalendarSystem | "ambiguous" | "mixed" | "none";
  /** 0–1. */
  confidence: number;
  counts: { AD: number; BS: number; ambiguous: number; invalid: number };
  rows: RowDetection[];
  /** true when the user must look at the result before importing. */
  needsReview: boolean;
  headerHint: CalendarSystem | null;
};

export function detectCalendar(values: (string | null | undefined)[], opts: DetectOptions = {}): Detection {
  const rows = values.map((v, i) => classifyDate(v, i, opts)).filter((r) => r.raw.trim() !== "" || r.calendar !== "invalid");
  const counts = { AD: 0, BS: 0, ambiguous: 0, invalid: 0 };
  for (const r of rows) counts[r.calendar]++;
  const hint = headerHint(opts.header);
  const total = rows.length;

  let calendar: Detection["calendar"];
  if (total === 0) calendar = "none";
  else if (counts.AD > 0 && counts.BS > 0) calendar = "mixed";
  else if (counts.AD > 0) calendar = "AD";
  else if (counts.BS > 0) calendar = "BS";
  else calendar = counts.ambiguous > 0 ? "ambiguous" : "none";

  const decided = calendar === "AD" || calendar === "BS" ? counts[calendar] : 0;
  let confidence = total === 0 ? 0 : decided / total;
  if (hint && hint === calendar) confidence = Math.min(1, confidence + 0.1);
  if (hint && (calendar === "AD" || calendar === "BS") && hint !== calendar) confidence = Math.max(0, confidence - 0.3);

  const needsReview =
    calendar === "mixed" || calendar === "ambiguous" || calendar === "none" || counts.ambiguous > 0 || counts.invalid > 0 || rows.some((r) => r.dayMonthAmbiguous) || rows.some((r) => r.projected);
  return { calendar, confidence, counts, rows, needsReview, headerHint: hint };
}

/** Converts every value using an explicitly chosen calendar (the user's override). */
export function convertAll(values: (string | null | undefined)[], calendar: CalendarSystem, opts: ParseOptions = {}) {
  return values.map((raw, index) => {
    const r = parseDate(raw, calendar, opts);
    return r.ok ? { index, raw: String(raw ?? ""), iso: r.iso as IsoDate | null, error: null as string | null, dayMonthAmbiguous: r.dayMonthAmbiguous, projected: r.projected } : { index, raw: String(raw ?? ""), iso: null as IsoDate | null, error: r.error, dayMonthAmbiguous: false, projected: false };
  });
}

// ---------------------------------------------------------------- ranges

export type DateRange = { from: IsoDate; to: IsoDate };

function firstOfMonth(calendar: CalendarSystem, year: number, month: number): IsoDate | null {
  return isoFromYmd(calendar, { year, month, day: 1 });
}

export function monthRange(calendar: CalendarSystem, iso: IsoDate): DateRange {
  const ymd = ymdOf(calendar, iso) ?? ymdOf("AD", iso)!;
  const cal: CalendarSystem = ymdOf(calendar, iso) ? calendar : "AD";
  const dim = daysInMonth(cal, ymd.year, ymd.month)!;
  return { from: isoFromYmd(cal, { ...ymd, day: 1 })!, to: isoFromYmd(cal, { ...ymd, day: dim })! };
}

/** First day of the month `delta` months away, in the given calendar. */
export function addMonths(calendar: CalendarSystem, iso: IsoDate, delta: number): IsoDate {
  const cal: CalendarSystem = ymdOf(calendar, iso) ? calendar : "AD";
  const ymd = ymdOf(cal, iso)!;
  const idx = ymd.year * 12 + (ymd.month - 1) + delta;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return firstOfMonth(cal, y, m) ?? iso;
}

export function yearRange(calendar: CalendarSystem, iso: IsoDate): DateRange {
  const cal: CalendarSystem = ymdOf(calendar, iso) ? calendar : "AD";
  const y = ymdOf(cal, iso)!.year;
  return { from: isoFromYmd(cal, { year: y, month: 1, day: 1 })!, to: isoFromYmd(cal, { year: y, month: 12, day: daysInMonth(cal, y, 12)! })! };
}

/**
 * Nepal's fiscal year runs Shrawan 1 – Ashadh end. `startYear` is the BS year
 * it begins in (2083 -> "2083/84").
 */
export function bsFiscalYearRange(startYear: number): (DateRange & { label: string }) | null {
  const from = convertBStoAD({ year: startYear, month: 4, day: 1 });
  const lastDay = bsDaysInMonth(startYear + 1, 3);
  const to = lastDay ? convertBStoAD({ year: startYear + 1, month: 3, day: lastDay }) : null;
  return from && to ? { from, to, label: `${startYear}/${pad2((startYear + 1) % 100)}` } : null;
}

export function bsFiscalYearOf(iso: IsoDate): (DateRange & { label: string; startYear: number }) | null {
  const bs = convertADtoBS(iso);
  if (!bs) return null;
  const startYear = bs.month >= 4 ? bs.year : bs.year - 1;
  const r = bsFiscalYearRange(startYear);
  return r ? { ...r, startYear } : null;
}

/** "Ashwin 2083" / "September 2026" — the month containing `iso`, in the given calendar. */
export function monthLabel(calendar: CalendarSystem, iso: IsoDate): string {
  const cal: CalendarSystem = ymdOf(calendar, iso) ? calendar : "AD";
  const ymd = ymdOf(cal, iso)!;
  return `${monthNames(cal)[ymd.month - 1]} ${ymd.year}`;
}

/** Real month boundaries (AD ISO) for `back` months before and `ahead` months after the month of `today`. */
export function monthChoices(calendar: CalendarSystem, today: IsoDate, back: number, ahead: number): (DateRange & { label: string })[] {
  const out: (DateRange & { label: string })[] = [];
  for (let d = ahead; d >= -back; d--) {
    const anchor = addMonths(calendar, today, d);
    out.push({ ...monthRange(calendar, anchor), label: monthLabel(calendar, anchor) });
  }
  return out;
}

/**
 * Statutory filing deadline for a month: the 25th of the FOLLOWING month in the
 * organization's calendar (Nepal VAT/TDS practice). For a BS organization that is
 * the 25th of the next BS month, not "month-end + 25 AD days".
 */
export function filingDueDate(calendar: CalendarSystem, monthAnchor: IsoDate, dayOfNextMonth = 25): IsoDate {
  const cal: CalendarSystem = ymdOf(calendar, monthAnchor) ? calendar : "AD";
  const next = ymdOf(cal, addMonths(cal, monthAnchor, 1))!;
  return isoFromYmd(cal, { ...next, day: Math.min(dayOfNextMonth, daysInMonth(cal, next.year, next.month) ?? dayOfNextMonth) }) ?? monthAnchor;
}

export type RangePreset = "today" | "this_week" | "this_month" | "last_month" | "this_fiscal_year";

/**
 * Period presets computed in the ORGANIZATION'S calendar — "this month" for a
 * BS organization is the current BS month (e.g. 1–31 Ashwin), not the
 * Gregorian one. `fiscal` is the organization's configured fiscal year, if any.
 */
export function presetRange(preset: RangePreset, calendar: CalendarSystem, today: IsoDate = todayIso(), fiscal?: DateRange | null): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this_week": {
      const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
      return { from: monday, to: today };
    }
    case "this_month":
      return { from: monthRange(calendar, today).from, to: today };
    case "last_month":
      return monthRange(calendar, addMonths(calendar, today, -1));
    case "this_fiscal_year": {
      if (fiscal && fiscal.from <= today && today <= fiscal.to) return { from: fiscal.from, to: today };
      if (calendar === "BS") {
        const fy = bsFiscalYearOf(today);
        if (fy) return { from: fy.from, to: today };
      }
      return { from: yearRange("AD", today).from, to: today };
    }
  }
}

// ------------------------------------------------------ picker helpers

export type MonthCells = { year: number; month: number; monthName: string; leading: number; days: { day: number; iso: IsoDate }[] };

/** Cells for one calendar month, with the weekday offset the first day falls on. */
export function monthCells(calendar: CalendarSystem, year: number, month: number): MonthCells | null {
  const dim = daysInMonth(calendar, year, month);
  const first = dim ? isoFromYmd(calendar, { year, month, day: 1 }) : null;
  if (!dim || !first) return null;
  const days = Array.from({ length: dim }, (_, i) => ({ day: i + 1, iso: isoFromYmd(calendar, { year, month, day: i + 1 })! }));
  return { year, month, monthName: monthNames(calendar)[month - 1], leading: weekdayOf(first), days };
}

export function yearBounds(calendar: CalendarSystem): [number, number] {
  return calendar === "BS" ? [BS_MIN_YEAR, BS_MAX_YEAR] : [1900, 2100];
}
