// Planned events: spending (or a change in sales) the owner is thinking about, tried against the forecast before any money moves.
// A planned event is only a plan: it posts nothing, approves nothing, and is always labelled Planned.

import { addDays, daysBetween, type ForecastDay } from "./forecast-rules";

export const EVENT_CATEGORIES = [
  { key: "repair", label: "Repair and maintenance" },
  { key: "asset", label: "Asset purchase" },
  { key: "stock", label: "Stock-up" },
  { key: "hiring", label: "Hiring" },
  { key: "bonus", label: "Bonus" },
  { key: "tax_legal", label: "Tax or legal" },
  { key: "profit_distribution", label: "Profit distribution" },
  { key: "insurance_licence", label: "Insurance or licence" },
  { key: "other", label: "Other" },
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number]["key"];

export const PATTERNS = [
  { key: "full", label: "Pay in full on the date" },
  { key: "advance_balance", label: "Advance, then the balance" },
  { key: "instalments", label: "Equal instalments" },
  { key: "credit", label: "On credit, paid later" },
] as const;
export type PaymentPattern = (typeof PATTERNS)[number]["key"];

export const URGENCIES = [
  { key: "must_do", label: "Must do" },
  { key: "should_do_soon", label: "Should do soon" },
  { key: "can_wait", label: "Can wait" },
] as const;
export type Urgency = (typeof URGENCIES)[number]["key"];

export const SALES_EFFECTS = [
  { key: "none", label: "No effect on sales" },
  { key: "raise", label: "Should raise sales" },
  { key: "interrupt", label: "Will interrupt sales" },
] as const;
export type SalesEffect = (typeof SALES_EFFECTS)[number]["key"];

export type PlannedEvent = {
  id: string;
  name: string;
  category: EventCategory;
  vendorId: string | null;
  vendorName: string | null;
  estimate: number;
  low: number | null;
  high: number | null;
  earliestDate: string;
  latestDate: string | null;
  plannedDate: string;
  pattern: PaymentPattern;
  advancePct: number | null;
  balanceDays: number | null;
  instalments: number | null;
  intervalDays: number | null;
  creditDays: number | null;
  urgency: Urgency;
  salesEffect: SalesEffect;
  /** Cash a month that sales would gain or lose. */
  salesEffectMonthly: number | null;
  salesEffectDays: number | null;
  status: "planned" | "done" | "cancelled";
  notes: string | null;
};

/** The parts of an event that decide its cash, so the form can try a draft before it is saved. */
export type EventDraft = Pick<PlannedEvent, "estimate" | "high" | "plannedDate" | "pattern" | "advancePct" | "balanceDays" | "instalments" | "intervalDays" | "creditDays" | "salesEffect" | "salesEffectMonthly" | "salesEffectDays">;

/** A dated change in cash: negative is money out. */
export type Flow = { date: string; amount: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** When the money for an event leaves, by its payment pattern. `high` tries the top of its range. */
export function paymentFlows(e: EventDraft, kind: "expected" | "high" = "expected"): Flow[] {
  const total = kind === "high" ? (e.high ?? e.estimate) : e.estimate;
  if (!(total > 0)) return [];
  const on = e.plannedDate;
  switch (e.pattern) {
    case "advance_balance": {
      const pct = Math.min(Math.max(e.advancePct ?? 50, 0), 100);
      const advance = round2((total * pct) / 100);
      return [
        { date: on, amount: -advance },
        { date: addDays(on, Math.max(e.balanceDays ?? 30, 0)), amount: -round2(total - advance) },
      ].filter((f) => f.amount !== 0);
    }
    case "instalments": {
      const n = Math.min(Math.max(Math.round(e.instalments ?? 3), 1), 60);
      const every = Math.max(Math.round(e.intervalDays ?? 30), 1);
      const part = round2(total / n);
      return Array.from({ length: n }, (_, i) => ({ date: addDays(on, i * every), amount: -(i === n - 1 ? round2(total - part * (n - 1)) : part) }));
    }
    case "credit":
      return [{ date: addDays(on, Math.max(e.creditDays ?? 30, 0)), amount: -round2(total) }];
    default:
      return [{ date: on, amount: -round2(total) }];
  }
}

/** The effect on sales, spread evenly over its days: extra cash after the event, or cash lost from the event date. */
export function salesFlows(e: EventDraft): Flow[] {
  if (e.salesEffect === "none" || !e.salesEffectMonthly || !e.salesEffectDays) return [];
  const perDay = e.salesEffectMonthly / 30;
  const days = Math.min(Math.max(Math.round(e.salesEffectDays), 1), 365);
  const start = e.salesEffect === "raise" ? 1 : 0;
  const sign = e.salesEffect === "raise" ? 1 : -1;
  return Array.from({ length: days }, (_, i) => ({ date: addDays(e.plannedDate, start + i), amount: round2(sign * perDay) }));
}

export const eventFlows = (e: EventDraft, kind: "expected" | "high" = "expected"): Flow[] => [...paymentFlows(e, kind), ...salesFlows(e)];

/** The forecast's days with extra flows added and the balance carried forward again. */
export function rollForward(openingCash: number, days: ForecastDay[], flows: Flow[]): ForecastDay[] {
  const extra = new Map<string, number>();
  for (const f of flows) extra.set(f.date, (extra.get(f.date) ?? 0) + f.amount);
  let balance = openingCash;
  return days.map((d) => {
    const x = extra.get(d.date) ?? 0;
    const moneyIn = d.moneyIn + (x > 0 ? x : 0);
    const moneyOut = d.moneyOut + (x < 0 ? -x : 0);
    balance = round2(balance + moneyIn - moneyOut);
    return { date: d.date, moneyIn: round2(moneyIn), moneyOut: round2(moneyOut), balance };
  });
}

export type Position = {
  lowest: { date: string; balance: number };
  /** First day the balance is under the reserve, or null. */
  breachDate: string | null;
  /** First day the balance is under zero, or null. */
  shortfallDate: string | null;
  endBalance: number;
  /** The lowest balance less the reserve. Negative is a shortfall against the reserve. */
  headroom: number;
};

export function positionOf(days: ForecastDay[], reserve: number): Position {
  let lowest = days[0] ? { date: days[0].date, balance: days[0].balance } : { date: "", balance: 0 };
  for (const d of days) if (d.balance < lowest.balance) lowest = { date: d.date, balance: d.balance };
  return {
    lowest,
    breachDate: reserve > 0 ? (days.find((d) => d.balance < reserve)?.date ?? null) : null,
    shortfallDate: days.find((d) => d.balance < 0)?.date ?? null,
    endBalance: days.length ? days[days.length - 1].balance : 0,
    headroom: round2(lowest.balance - reserve),
  };
}

/**
 * The date in the event's window that leaves the most cash at the lowest point. Ties go to the earliest date.
 * Dates the forecast does not reach are not tried, because they cannot change anything it shows.
 */
export function safestDate(openingCash: number, days: ForecastDay[], baseFlows: Flow[], e: EventDraft, window: { earliest: string; latest: string | null }, reserve: number): { date: string; position: Position } | null {
  if (days.length === 0) return null;
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const from = window.earliest > first ? window.earliest : first;
  const to = window.latest && window.latest < last ? window.latest : last;
  if (from > to) return null;
  let best: { date: string; position: Position } | null = null;
  const span = Math.min(daysBetween(from, to), 400);
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    const position = positionOf(rollForward(openingCash, days, [...baseFlows, ...eventFlows({ ...e, plannedDate: date })]), reserve);
    if (!best || position.lowest.balance > best.position.lowest.balance) best = { date, position };
  }
  return best;
}

// ---------------------------------------------------------------- Sales needed

export type SalesNeed = { shortfall: number; netPerRupee: number; salesNeeded: number | null; note: string | null };

/**
 * How much more selling it would take to close a shortfall against the reserve. Each rupee of sales brings in the share that is
 * collected, less the share that goes on the cost of what is sold. Both shares are assumptions the owner can change.
 */
export function salesNeeded(shortfall: number, collectedShare: number, variableCostShare: number): SalesNeed {
  const gap = Math.max(round2(shortfall), 0);
  const netPerRupee = round2(collectedShare - variableCostShare);
  if (gap === 0) return { shortfall: 0, netPerRupee, salesNeeded: 0, note: null };
  if (netPerRupee <= 0.02) return { shortfall: gap, netPerRupee, salesNeeded: null, note: "At these shares, selling more does not add cash. Costs or collections need to change." };
  return { shortfall: gap, netPerRupee, salesNeeded: round2(gap / netPerRupee), note: null };
}

// ---------------------------------------------------------------- Checking an event before it is saved

export type EventInput = Omit<PlannedEvent, "id" | "vendorName" | "status">;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const inList = (list: readonly { key: string }[], v: string) => list.some((x) => x.key === v);
const whole = (v: number | null, min: number, max: number) => v === null || (Number.isInteger(v) && v >= min && v <= max);

/** The first thing wrong with an event, in plain words, or null when it can be saved. */
export function validateEvent(e: EventInput): string | null {
  if (!e.name.trim()) return "Give the event a name.";
  if (e.name.trim().length > 120) return "The name is too long.";
  if (!inList(EVENT_CATEGORIES, e.category)) return "Choose what kind of event this is.";
  if (!inList(PATTERNS, e.pattern)) return "Choose how it will be paid.";
  if (!inList(URGENCIES, e.urgency)) return "Choose how urgent it is.";
  if (!inList(SALES_EFFECTS, e.salesEffect)) return "Choose its effect on sales.";
  if (!Number.isFinite(e.estimate) || e.estimate <= 0) return "Enter the estimated amount.";
  if (e.low !== null && (!Number.isFinite(e.low) || e.low < 0 || e.low > e.estimate)) return "The low end cannot be more than the estimate.";
  if (e.high !== null && (!Number.isFinite(e.high) || e.high < e.estimate)) return "The high end cannot be less than the estimate.";
  if (!ISO.test(e.earliestDate) || !ISO.test(e.plannedDate)) return "Choose the dates.";
  if (e.latestDate !== null && (!ISO.test(e.latestDate) || e.latestDate < e.earliestDate)) return "The latest date cannot be before the earliest.";
  if (e.plannedDate < e.earliestDate || (e.latestDate !== null && e.plannedDate > e.latestDate)) return "The chosen date must fall between the earliest and latest dates.";
  if (!whole(e.advancePct, 0, 100)) return "The advance must be a whole percentage from 0 to 100.";
  if (!whole(e.balanceDays, 0, 365) || !whole(e.creditDays, 0, 365)) return "Days to pay later must be a whole number up to 365.";
  if (!whole(e.instalments, 1, 60) || !whole(e.intervalDays, 1, 365)) return "Instalments must be 1 to 60, a whole number of days apart.";
  if (e.salesEffect !== "none") {
    if (e.salesEffectMonthly === null || !(e.salesEffectMonthly > 0)) return "Enter how much sales would change by in a month.";
    if (e.salesEffectDays === null || !whole(e.salesEffectDays, 1, 365)) return "Enter for how many days sales are affected.";
  }
  return null;
}
