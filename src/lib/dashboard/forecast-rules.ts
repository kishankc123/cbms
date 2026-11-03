// The cash forecast: what is expected to come in and go out, day by day, from the cash held today. Pure rules, no database.
// Everything here is an estimate built from documents already in the books. Nothing is posted and no figure is promised.

export type ForecastCategory = "collections" | "supplier_payments" | "expenses" | "recurring" | "payroll" | "taxes";

export const FORECAST_CATEGORIES: { key: ForecastCategory; label: string; side: "in" | "out" }[] = [
  { key: "collections", label: "Customer collections", side: "in" },
  { key: "supplier_payments", label: "Supplier bills", side: "out" },
  { key: "expenses", label: "Unpaid expenses", side: "out" },
  { key: "recurring", label: "Recurring expenses not yet booked", side: "out" },
  { key: "payroll", label: "Payroll", side: "out" },
  { key: "taxes", label: "Taxes", side: "out" },
];

/** How sure we are of a date: Confirmed (a due date on a posted document), Expected (learned or assumed), Estimated (amount worked out, not entered). */
export type Certainty = "confirmed" | "expected" | "estimated";

/** Why this date: the document's due date, the customer's own habit, the organisation's usual, or an overdue item assumed to move soon. */
export type Basis = "due_date" | "customer_pattern" | "default" | "overdue" | "scheduled" | "assumed";

export type ForecastEvent = {
  id: string;
  category: ForecastCategory;
  side: "in" | "out";
  date: string;
  amount: number;
  party: string;
  basis: Basis;
  certainty: Certainty;
};

/** An overdue item is assumed to move this many days from today. */
export const OVERDUE_DAYS = 7;
/** Used when there is no due date, no history and no setting. */
export const FALLBACK_COLLECTION_DAYS = 30;
/** Payroll is assumed paid this many days after its period ends. */
export const PAYROLL_LAG_DAYS = 7;
/** A customer's own habit is only used once it has this many settled invoices behind it. */
export const MIN_HISTORY = 3;

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);

// ---------------------------------------------------------------- When customers pay

export type SettledInvoice = { customerId: string; invoiceId: string; amount: number; docDate: string; dueDate: string | null; paidDate: string };

const weighted = (rows: { weight: number; value: number }[]) => {
  const w = rows.reduce((s, r) => s + r.weight, 0);
  return w > 0 ? rows.reduce((s, r) => s + r.weight * r.value, 0) / w : null;
};

/** The usual days from invoice date to payment across everyone (amount-weighted), or null when nothing has been settled yet. */
export function usualDaysToPay(history: SettledInvoice[]): number | null {
  const avg = weighted(history.map((h) => ({ weight: h.amount, value: daysBetween(h.docDate, h.paidDate) })));
  return avg === null ? null : Math.max(0, Math.round(avg));
}

export type CustomerHabit = { lagDays: number; samples: number };

/**
 * How many days after the agreed date each customer actually pays, weighted by invoice size. Only customers with at least MIN_HISTORY
 * settled invoices get one. A negative lag means they pay early. The agreed date is the due date, or the invoice date plus `defaultDays`.
 */
export function customerHabits(history: SettledInvoice[], defaultDays: number): Map<string, CustomerHabit> {
  const by = new Map<string, SettledInvoice[]>();
  for (const h of history) by.set(h.customerId, [...(by.get(h.customerId) ?? []), h]);
  const out = new Map<string, CustomerHabit>();
  for (const [customerId, rows] of by) {
    if (new Set(rows.map((r) => r.invoiceId)).size < MIN_HISTORY) continue;
    const lag = weighted(rows.map((r) => ({ weight: r.amount, value: daysBetween(r.dueDate ?? addDays(r.docDate, defaultDays), r.paidDate) })));
    if (lag !== null) out.set(customerId, { lagDays: Math.round(lag), samples: new Set(rows.map((r) => r.invoiceId)).size });
  }
  return out;
}

/** The day an open invoice is expected to be paid, and why that day. */
export function collectionDate(i: { dueDate: string | null; docDate: string; today: string; habit: CustomerHabit | null; defaultDays: number }): { date: string; basis: Basis } {
  const agreed = i.dueDate ?? addDays(i.docDate, i.defaultDays);
  let date = agreed;
  let basis: Basis = i.dueDate ? "due_date" : "default";
  if (i.habit) {
    date = addDays(agreed, i.habit.lagDays);
    basis = "customer_pattern";
  }
  if (date < i.today) return { date: addDays(i.today, OVERDUE_DAYS), basis: "overdue" };
  return { date, basis };
}

/** The day a bill or expense is expected to be paid: on its due date, or soon if that has passed. */
export function paymentDate(i: { dueDate: string | null; docDate: string; today: string }): { date: string; basis: Basis } {
  const date = i.dueDate ?? i.docDate;
  if (date < i.today) return { date: addDays(i.today, OVERDUE_DAYS), basis: "overdue" };
  return { date, basis: i.dueDate ? "due_date" : "assumed" };
}

// ---------------------------------------------------------------- Payroll

/** Future salary payments: the last finalised month's pay repeated for each following period that ends inside the horizon. */
export function payrollEvents(last: { periodStart: string; periodEnd: string; total: number } | null, today: string, horizonEnd: string): ForecastEvent[] {
  if (!last || last.total <= 0) return [];
  const len = daysBetween(last.periodStart, last.periodEnd) + 1;
  const out: ForecastEvent[] = [];
  for (let k = 1; k <= 24; k++) {
    const end = addDays(last.periodEnd, len * k);
    const pay = addDays(end, PAYROLL_LAG_DAYS);
    if (pay > horizonEnd) break;
    if (pay < today) continue;
    out.push({ id: `payroll-${end}`, category: "payroll", side: "out", date: pay, amount: round2(last.total), party: "Salaries", basis: "scheduled", certainty: "expected" });
  }
  return out;
}

// ---------------------------------------------------------------- The reserve

export type ReserveSettings = { months: number; override: number | null };

/** The cash to keep in hand and how it was worked out. */
export function reserveOf(settings: ReserveSettings, fixedMonthly: number): { amount: number; how: string } {
  if (settings.override !== null) return { amount: round2(settings.override), how: "A fixed amount set in the planning settings." };
  return { amount: round2(fixedMonthly * settings.months), how: `${settings.months} ${settings.months === 1 ? "month" : "months"} of fixed expenses.` };
}

/** Fixed expenses per month: what was actually spent a month on payroll and recurring categories, else the recurring definitions. */
export function fixedMonthly(actualPerMonth: number, definitionsPerMonth: number): number {
  return round2(actualPerMonth > 0 ? actualPerMonth : definitionsPerMonth);
}

// ---------------------------------------------------------------- Working capital

export type WorkingCapital = { cash: number; receivables: number; stock: number; currentAssets: number; payables: number; salaryPayable: number; taxPayable: number; currentLiabilities: number; workingCapital: number };

export function workingCapitalOf(p: { cash: number; receivables: number; stock: number; payables: number; salaryPayable: number; taxPayable: number }): WorkingCapital {
  const currentAssets = round2(p.cash + p.receivables + p.stock);
  const currentLiabilities = round2(p.payables + p.salaryPayable + p.taxPayable);
  return { ...p, currentAssets, currentLiabilities, workingCapital: round2(currentAssets - currentLiabilities) };
}

// ---------------------------------------------------------------- The forecast

export type ForecastDay = { date: string; moneyIn: number; moneyOut: number; balance: number };
export type ForecastWarning = { level: "critical" | "action"; date: string; message: string };

export type Forecast = {
  today: string;
  horizonEnd: string;
  openingCash: number;
  endBalance: number;
  totalIn: number;
  totalOut: number;
  days: ForecastDay[];
  lowest: { date: string; balance: number };
  reserve: number;
  /** The lowest projected balance less the reserve: what can be spent without touching the reserve. Negative means a shortfall. */
  availableToPlan: number;
  byCategory: { key: ForecastCategory; label: string; side: "in" | "out"; amount: number; count: number }[];
  warnings: ForecastWarning[];
};

export function buildForecast(input: { today: string; horizonDays: number; openingCash: number; reserve: number; events: ForecastEvent[] }): Forecast {
  const { today, horizonDays, openingCash, reserve } = input;
  const horizonEnd = addDays(today, horizonDays);
  const inRange = input.events.filter((e) => e.date >= today && e.date <= horizonEnd);

  const byDate = new Map<string, { moneyIn: number; moneyOut: number }>();
  for (const e of inRange) {
    const d = byDate.get(e.date) ?? { moneyIn: 0, moneyOut: 0 };
    if (e.side === "in") d.moneyIn += e.amount;
    else d.moneyOut += e.amount;
    byDate.set(e.date, d);
  }

  const days: ForecastDay[] = [];
  let balance = openingCash;
  let lowest = { date: today, balance: openingCash };
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const d = byDate.get(date) ?? { moneyIn: 0, moneyOut: 0 };
    balance = round2(balance + d.moneyIn - d.moneyOut);
    days.push({ date, moneyIn: round2(d.moneyIn), moneyOut: round2(d.moneyOut), balance });
    if (balance < lowest.balance) lowest = { date, balance };
  }

  const byCategory = FORECAST_CATEGORIES.map((c) => {
    const rows = inRange.filter((e) => e.category === c.key);
    return { ...c, amount: round2(rows.reduce((s, e) => s + e.amount, 0)), count: rows.length };
  }).filter((c) => c.count > 0);

  const warnings: ForecastWarning[] = [];
  const firstBelowZero = days.find((d) => d.balance < 0);
  const firstBelowReserve = days.find((d) => d.balance < reserve);
  if (firstBelowZero) warnings.push({ level: "critical", date: firstBelowZero.date, message: "Cash is expected to run out" });
  if (firstBelowReserve && reserve > 0) warnings.push({ level: "action", date: firstBelowReserve.date, message: "Cash is expected to fall below the reserve" });

  return {
    today,
    horizonEnd,
    openingCash: round2(openingCash),
    endBalance: balance,
    totalIn: round2(inRange.filter((e) => e.side === "in").reduce((s, e) => s + e.amount, 0)),
    totalOut: round2(inRange.filter((e) => e.side === "out").reduce((s, e) => s + e.amount, 0)),
    days,
    lowest,
    reserve: round2(reserve),
    availableToPlan: round2(lowest.balance - reserve),
    byCategory,
    warnings,
  };
}

export const HORIZONS = [7, 30, 60, 90] as const;
export const MAX_HORIZON = 365;

export function parseHorizon(v: unknown): number {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= MAX_HORIZON ? n : 30;
}
