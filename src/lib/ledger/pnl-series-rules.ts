import { COST_OF_SALES, type AccountInfo, type Amount } from "./pnl-compare-rules";

// Profit & Loss with any number of periods side by side (a quarter's three months, the quarter and the same quarter a year ago).
// Same shape as the two-period comparison: costs and expenses are negative, so a positive change is better for profit. Plain functions, so they can be tested.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SeriesRow = { accountId: string; sub: string; values: number[] };
export type SeriesHeading = { key: string; name: string; rows: SeriesRow[] };
export type SeriesSection = { headings: SeriesHeading[]; totals: number[] };
export type PeriodAmounts = { income: Amount[]; expenses: Amount[] };
export type Series = { income: SeriesSection; cost: SeriesSection; expenses: SeriesSection; grossProfit: number[]; netProfit: number[] };

const sum = (a: number[], b: number[]) => a.map((v, i) => round2(v + b[i]));

function seriesSection(infos: Map<string, AccountInfo>, lists: Amount[][], sign: 1 | -1, only: (group: AccountInfo) => boolean): SeriesSection {
  const rows = new Map<string, SeriesRow>();
  lists.forEach((list, i) => {
    for (const { accountId, amount } of list) {
      const a = infos.get(accountId);
      const group = a && ((a.parentId && infos.get(a.parentId)) || a);
      if (!a || !group || !only(group)) continue;
      const row = rows.get(accountId) ?? { accountId, sub: group === a ? "" : a.name, values: lists.map(() => 0) };
      row.values[i] = round2(sign * amount);
      rows.set(accountId, row);
    }
  });
  const byGroup = new Map<string, SeriesHeading>();
  for (const row of [...rows.values()].sort((x, y) => infos.get(x.accountId)!.code.localeCompare(infos.get(y.accountId)!.code))) {
    const a = infos.get(row.accountId)!;
    const group = (a.parentId && infos.get(a.parentId)) || a;
    const h = byGroup.get(group.id) ?? { key: group.id, name: group.name, rows: [] };
    h.rows.push(row);
    byGroup.set(group.id, h);
  }
  const headings = [...byGroup.values()].sort((x, y) => infos.get(x.key)!.code.localeCompare(infos.get(y.key)!.code));
  return { headings, totals: headings.flatMap((h) => h.rows).reduce((t, r) => sum(t, r.values), lists.map(() => 0)) };
}

/** One column per period, in the order given. */
export function buildSeries(infos: Map<string, AccountInfo>, periods: PeriodAmounts[]): Series {
  const isCost = (g: AccountInfo) => g.subCategory === COST_OF_SALES;
  const income = seriesSection(infos, periods.map((p) => p.income), 1, () => true);
  const cost = seriesSection(infos, periods.map((p) => p.expenses), -1, isCost);
  const expenses = seriesSection(infos, periods.map((p) => p.expenses), -1, (g) => !isCost(g));
  const grossProfit = sum(income.totals, cost.totals);
  return { income, cost, expenses, grossProfit, netProfit: sum(grossProfit, expenses.totals) };
}

/** A column inserted after the first `count` columns that is their sum: a quarter after its three months. */
export function withTotalOf(s: Series, count: number): Series {
  const add = (v: number[]) => [...v.slice(0, count), round2(v.slice(0, count).reduce((a, b) => a + b, 0)), ...v.slice(count)];
  const sec = (x: SeriesSection): SeriesSection => ({ headings: x.headings.map((h) => ({ ...h, rows: h.rows.map((r) => ({ ...r, values: add(r.values) })) })), totals: add(x.totals) });
  return { income: sec(s.income), cost: sec(s.cost), expenses: sec(s.expenses), grossProfit: add(s.grossProfit), netProfit: add(s.netProfit) };
}
