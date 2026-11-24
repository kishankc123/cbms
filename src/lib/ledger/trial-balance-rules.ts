import type { AccountInfo } from "./pnl-compare-rules";

// The trial balance by period: for each account, what it held at the start (opening), what was debited and credited in the period (movement),
// and what it held at the end (closing). Plain functions, no database, so they can be tested.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total debits and credits posted to an account up to a date. */
export type Totals = { accountId: string; debit: number; credit: number };
export type Side = { dr: number; cr: number };
export type TbRow = { accountId: string; sub: string; opening: Side; movement: Side; closing: Side };
export type TbHeading = { key: string; name: string; rows: TbRow[] };
export type TbSection = { title: string; headings: TbHeading[] };
export type TrialBalanceByPeriod = { sections: TbSection[]; totals: { opening: Side; movement: Side; closing: Side } };

// The Profit and Loss accounts first, then the Balance Sheet ones.
const SECTIONS: [string, string][] = [["income", "Income"], ["expense", "Expenses"], ["asset", "Assets"], ["liability", "Liabilities"], ["equity", "Equity"]];
const ZERO: Side = { dr: 0, cr: 0 };

/** A balance sits on one side: whichever of debits and credits is larger, by the difference. */
export const net = (debit: number, credit: number): Side => (debit >= credit ? { dr: round2(debit - credit), cr: 0 } : { dr: 0, cr: round2(credit - debit) });
const add = (a: Side, b: Side): Side => ({ dr: round2(a.dr + b.dr), cr: round2(a.cr + b.cr) });
const isZero = (s: Side) => s.dr === 0 && s.cr === 0;

/** `opening` and `closing` are cumulative totals as at the day before the period and its last day; movement is the difference. Leave `opening` empty for a single date. */
export function buildTrialBalance(infos: Map<string, AccountInfo>, opening: Totals[], closing: Totals[]): TrialBalanceByPeriod {
  const open = new Map(opening.map((t) => [t.accountId, t]));
  const rows: TbRow[] = [];
  for (const c of closing) {
    const a = infos.get(c.accountId);
    if (!a) continue;
    const o = open.get(c.accountId) ?? { debit: 0, credit: 0 };
    const row: TbRow = { accountId: a.id, sub: "", opening: net(o.debit, o.credit), movement: { dr: round2(c.debit - o.debit), cr: round2(c.credit - o.credit) }, closing: net(c.debit, c.credit) };
    if (!isZero(row.opening) || !isZero(row.movement) || !isZero(row.closing)) rows.push(row);
  }
  rows.sort((x, y) => infos.get(x.accountId)!.code.localeCompare(infos.get(y.accountId)!.code));

  const sections = SECTIONS.map(([category, title]) => {
    const byGroup = new Map<string, TbHeading>();
    for (const row of rows.filter((r) => infos.get(r.accountId)!.category === category)) {
      const a = infos.get(row.accountId)!;
      const group = (a.parentId && infos.get(a.parentId)) || a;
      const h = byGroup.get(group.id) ?? { key: group.id, name: group.name, rows: [] };
      h.rows.push({ ...row, sub: group === a ? "" : a.name });
      byGroup.set(group.id, h);
    }
    return { title, headings: [...byGroup.values()].sort((x, y) => infos.get(x.key)!.code.localeCompare(infos.get(y.key)!.code)) };
  }).filter((s) => s.headings.length > 0);

  const totals = rows.reduce((t, r) => ({ opening: add(t.opening, r.opening), movement: add(t.movement, r.movement), closing: add(t.closing, r.closing) }), { opening: ZERO, movement: ZERO, closing: ZERO });
  return { sections, totals };
}

/** What a heading holds as a whole: its accounts' opening and closing balances netted together, and their movement added up. */
export function headingTotals(rows: readonly TbRow[]): { opening: Side; movement: Side; closing: Side } {
  const sum = (pick: (r: TbRow) => Side) => rows.reduce((t, r) => ({ dr: round2(t.dr + pick(r).dr), cr: round2(t.cr + pick(r).cr) }), ZERO);
  const netted = (pick: (r: TbRow) => Side) => {
    const t = sum(pick);
    return net(t.dr, t.cr);
  };
  return { opening: netted((r) => r.opening), movement: sum((r) => r.movement), closing: netted((r) => r.closing) };
}

/** Whether debits equal credits in each of the three. */
export const balanced = (s: Side) => s.dr === s.cr;
