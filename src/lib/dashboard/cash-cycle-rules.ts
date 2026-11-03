// The cash conversion cycle: how many days money is tied up between paying for stock and collecting from the customer who bought it.
// Pure rules, no database. Everything is measured over a recent window so it moves with the business.

export const CYCLE_DAYS = 90;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type CycleInputs = {
  /** What customers still owe, and what was invoiced in the window. */
  receivables: number;
  sales: number;
  /** Stock held at cost, and the cost of what was sold in the window. */
  stock: number;
  costOfSales: number;
  /** What is still owed on supplier bills, and what was bought on those bills in the window. */
  payables: number;
  purchases: number;
  days: number;
};

export type CycleMetric = {
  /** Days, or null when it cannot be measured (money is owed but nothing moved in the window). */
  days: number | null;
  /** Cash freed each time this gets one day better: a day less to collect, a day less in stock, a day longer to pay. */
  perDay: number;
};

export type Cycle = {
  dso: CycleMetric;
  dio: CycleMetric;
  dpo: CycleMetric;
  /** Days from paying suppliers to collecting from customers: collect + stock - pay. Null if any part cannot be measured. */
  cycleDays: number | null;
  /** Cash held in the day-to-day cycle: what customers owe plus stock, less what is owed to suppliers. */
  tiedUp: number;
};

function measure(balance: number, flow: number, days: number): CycleMetric {
  const perDay = round2(flow / days);
  if (balance <= 0) return { days: 0, perDay };
  if (flow <= 0) return { days: null, perDay };
  return { days: round1((balance / flow) * days), perDay };
}

export function cycleOf(i: CycleInputs): Cycle {
  const dso = measure(i.receivables, i.sales, i.days);
  const dio = measure(i.stock, i.costOfSales, i.days);
  const dpo = measure(i.payables, i.purchases, i.days);
  const cycleDays = dso.days === null || dio.days === null || dpo.days === null ? null : round1(dso.days + dio.days - dpo.days);
  return { dso, dio, dpo, cycleDays, tiedUp: round2(i.receivables + i.stock - i.payables) };
}

export type SlowPayer = { customerId: string; name: string; invoices: number; daysLate: number };
