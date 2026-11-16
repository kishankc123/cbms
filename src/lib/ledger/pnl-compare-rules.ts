import { addDays, addMonths, fiscalYearOf, formatDate, monthLabel, monthNames, monthRange, weekdayOf, ymdOf, isoFromYmd, type CalendarSystem, type DateRange, type IsoDate } from "@/lib/calendar";

// Period choices and the comparison table for the comparative Profit & Loss. Plain functions, no database, so they can be tested.

export const PERIOD_KINDS = ["day", "week", "month", "quarter", "year"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export type CompareWith = "previous" | "last_year";

export const KIND_LABEL: Record<PeriodKind, string> = { day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Year" };
const ADJECTIVE: Record<PeriodKind, string> = { day: "Daily", week: "Weekly", month: "Monthly", quarter: "Quarterly", year: "Yearly" };
const HOW_MANY: Record<PeriodKind, number> = { day: 62, week: 26, month: 36, quarter: 12, year: 6 };

export const asKind = (v: unknown): PeriodKind => (PERIOD_KINDS as readonly string[]).includes(v as string) ? (v as PeriodKind) : "month";
export const asCompare = (v: unknown): CompareWith => (v === "last_year" ? "last_year" : "previous");

// Quarters and years follow the fiscal year (Shrawan to Ashadh), whichever calendar the dates are shown in. Outside the Bikram Sambat tables they fall back to the calendar year.
const basis = (iso: IsoDate) => (ymdOf("BS", iso) ? ({ cal: "BS", start: 4 } as const) : ({ cal: "AD", start: 1 } as const));
const fiscalYear = (iso: IsoDate) => { const b = basis(iso); return fiscalYearOf(b.cal, b.start, iso)!; };

/** The day, week (Sunday to Saturday), month, fiscal quarter or fiscal year that contains `at`. */
export function periodOf(kind: PeriodKind, calendar: CalendarSystem, at: IsoDate): DateRange {
  switch (kind) {
    case "day":
      return { from: at, to: at };
    case "week": {
      const from = addDays(at, -weekdayOf(at));
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return monthRange(calendar, at);
    case "year": {
      const { from, to } = fiscalYear(at);
      return { from, to };
    }
    case "quarter": {
      const fy = fiscalYear(at);
      const b = basis(at);
      const monthsIn = (ymdOf(b.cal, at)!.month - b.start + 12) % 12;
      const first = addMonths(b.cal, fy.from, Math.floor(monthsIn / 3) * 3);
      return { from: first, to: addDays(addMonths(b.cal, first, 3), -1) };
    }
  }
}

/** The period to compare with: the one just before, or the same one a year earlier. */
export function comparisonOf(kind: PeriodKind, calendar: CalendarSystem, range: DateRange, how: CompareWith): DateRange {
  const before = periodOf(kind, calendar, addDays(range.from, -1));
  if (how === "previous" || kind === "year") return before;
  if (kind === "week") return periodOf("week", calendar, addDays(range.from, -364));
  if (kind === "day") {
    const ymd = ymdOf("AD", range.from)!;
    return periodOf("day", calendar, isoFromYmd("AD", { ...ymd, year: ymd.year - 1 }) ?? addDays(range.from, -365));
  }
  return periodOf(kind, calendar, addMonths(kind === "month" ? calendar : basis(range.from).cal, range.from, -12));
}

/** "Bhadra 2083", "Shrawan – Ashwin 2083", "FY 2083/84", or the dates for a day or week. */
export function periodLabel(kind: PeriodKind, calendar: CalendarSystem, r: DateRange): string {
  switch (kind) {
    case "day":
      return formatDate(r.from, calendar, "long");
    case "week":
      return `${formatDate(r.from, calendar, "long")} – ${formatDate(r.to, calendar, "long")}`;
    case "month":
      return monthLabel(calendar, r.from);
    case "year":
      return `FY ${fiscalYear(r.from).label}`;
    case "quarter": {
      const b = basis(r.from);
      const first = ymdOf(b.cal, r.from)!;
      return `${monthNames(b.cal)[first.month - 1]} – ${monthLabel(b.cal, r.to)}`;
    }
  }
}

/** "Monthly comparative Profit & Loss" */
export const reportTitle = (kind: PeriodKind, report = "Profit & Loss") => `${ADJECTIVE[kind]} comparative ${report}`;

/** The periods to choose from, newest first. The one in the address is added if it is older than the list. */
export function periodOptions(kind: PeriodKind, calendar: CalendarSystem, today: IsoDate, selected: IsoDate): { value: IsoDate; label: string }[] {
  const out: { value: IsoDate; label: string }[] = [];
  let p = periodOf(kind, calendar, today);
  for (let i = 0; i < HOW_MANY[kind]; i++) {
    out.push({ value: p.from, label: periodLabel(kind, calendar, p) });
    p = periodOf(kind, calendar, addDays(p.from, -1));
  }
  if (!out.some((o) => o.value === selected)) out.push({ value: selected, label: periodLabel(kind, calendar, periodOf(kind, calendar, selected)) });
  return out;
}

// ---------------------------------------------------------------- the table

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amounts are shown the way they affect profit: income positive, costs and expenses negative. So a positive change is always better. */
export type Pair = { cur: number; prev: number };
export type AccountInfo = { id: string; code: string; name: string; subCategory: string | null; parentId: string | null };
export type Amount = { accountId: string; amount: number };
export type Row = Pair & { accountId: string; sub: string };
export type Heading = { key: string; name: string; rows: Row[] };
export type Section = Pair & { headings: Heading[] };
export type Comparison = { income: Section; cost: Section; expenses: Section; grossProfit: Pair; netProfit: Pair };

export const COST_OF_SALES = "Cost of goods sold";

export function section(infos: Map<string, AccountInfo>, cur: Amount[], prev: Amount[], sign: 1 | -1, only: (group: AccountInfo) => boolean): Section {
  const rows = new Map<string, Row>();
  for (const [period, list] of [["cur", cur], ["prev", prev]] as const) {
    for (const { accountId, amount } of list) {
      const a = infos.get(accountId);
      if (!a) continue;
      const group = (a.parentId && infos.get(a.parentId)) || a;
      if (!only(group)) continue;
      const row = rows.get(accountId) ?? { accountId, sub: group === a ? "" : a.name, cur: 0, prev: 0 };
      row[period] = round2(sign * amount);
      rows.set(accountId, row);
    }
  }
  const byGroup = new Map<string, Heading>();
  const codes = new Map<string, string>();
  for (const row of [...rows.values()].sort((x, y) => infos.get(x.accountId)!.code.localeCompare(infos.get(y.accountId)!.code))) {
    const a = infos.get(row.accountId)!;
    const group = (a.parentId && infos.get(a.parentId)) || a;
    const h = byGroup.get(group.id) ?? { key: group.id, name: group.name, rows: [] };
    h.rows.push(row);
    byGroup.set(group.id, h);
    codes.set(group.id, group.code);
  }
  const headings = [...byGroup.values()].sort((x, y) => codes.get(x.key)!.localeCompare(codes.get(y.key)!));
  const all = headings.flatMap((h) => h.rows);
  return { headings, cur: round2(all.reduce((s, r) => s + r.cur, 0)), prev: round2(all.reduce((s, r) => s + r.prev, 0)) };
}

/** Builds the comparison from the income and expense amounts of each period (as profitAndLoss returns them). */
export function buildComparison(infos: Map<string, AccountInfo>, cur: { income: Amount[]; expenses: Amount[] }, prev: { income: Amount[]; expenses: Amount[] }): Comparison {
  const isCost = (g: AccountInfo) => g.subCategory === COST_OF_SALES;
  const income = section(infos, cur.income, prev.income, 1, () => true);
  const cost = section(infos, cur.expenses, prev.expenses, -1, isCost);
  const expenses = section(infos, cur.expenses, prev.expenses, -1, (g) => !isCost(g));
  const grossProfit = { cur: round2(income.cur + cost.cur), prev: round2(income.prev + cost.prev) };
  const netProfit = { cur: round2(grossProfit.cur + expenses.cur), prev: round2(grossProfit.prev + expenses.prev) };
  return { income, cost, expenses, grossProfit, netProfit };
}

export const change = (p: Pair) => round2(p.cur - p.prev);

/** Change as a percent of the earlier amount. "new" when there was nothing before, null when there is nothing to say. */
export function changePercent(p: Pair): number | "new" | null {
  if (p.cur === p.prev) return null;
  if (p.prev === 0) return "new";
  return round2(((p.cur - p.prev) / Math.abs(p.prev)) * 100);
}

/** A margin (gross or net profit) as a percent of income, for each period. Null when there is no income. */
export function margin(profit: Pair, income: Pair): { cur: number | null; prev: number | null } {
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 100));
  return { cur: pct(profit.cur, income.cur), prev: pct(profit.prev, income.prev) };
}

/** 1,234.00 / (1,234.00) / - */
export function money(n: number): string {
  if (n === 0) return "-";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

export function percentText(v: number | "new" | null): string {
  if (v === null) return "-";
  if (v === "new") return "new";
  return v < 0 ? `(${Math.abs(v).toFixed(1)}%)` : `${v.toFixed(1)}%`;
}

// ---------------------------------------------------------------- the balance sheet

export type BalanceSide = { assets: Amount[]; liabilities: Amount[]; equity: Amount[]; retainedEarnings: number };
export type BalanceComparison = { assets: Section; liabilities: Section; equity: Section; liabilitiesAndEquity: Pair; difference: Pair };

/** Assets, liabilities and equity (with the profit not yet closed to equity as its own line), each grouped under the Chart of Accounts groups. All amounts are as at a date. */
export function buildBalanceComparison(infos: Map<string, AccountInfo>, cur: BalanceSide, prev: BalanceSide): BalanceComparison {
  const all = () => true;
  const assets = section(infos, cur.assets, prev.assets, 1, all);
  const liabilities = section(infos, cur.liabilities, prev.liabilities, 1, all);
  const accountsEquity = section(infos, cur.equity, prev.equity, 1, all);
  const retained: Heading = { key: "retained", name: "Retained earnings (current)", rows: [{ accountId: "", sub: "", cur: cur.retainedEarnings, prev: prev.retainedEarnings }] };
  const equity: Section = {
    headings: cur.retainedEarnings === 0 && prev.retainedEarnings === 0 ? accountsEquity.headings : [...accountsEquity.headings, retained],
    cur: round2(accountsEquity.cur + cur.retainedEarnings),
    prev: round2(accountsEquity.prev + prev.retainedEarnings),
  };
  const liabilitiesAndEquity = { cur: round2(liabilities.cur + equity.cur), prev: round2(liabilities.prev + equity.prev) };
  return { assets, liabilities, equity, liabilitiesAndEquity, difference: { cur: round2(assets.cur - liabilitiesAndEquity.cur), prev: round2(assets.prev - liabilitiesAndEquity.prev) } };
}
