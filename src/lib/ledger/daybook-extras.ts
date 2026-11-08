import { ON_CREDIT, type DayEntry, type Daybook, type DocSection } from "./daybook-rules";

// Daybook phase 2, the parts that read the day rather than add it up: how the day compares with the same weekday a week ago, the credit given and taken
// that day, and the list of everything entered that day. Pure, like daybook-rules.ts.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- Compared with the same weekday last week ----

export type CompareRow = { key: string; label: string; now: number; before: number; change: number; /** null when there was nothing to compare with */ percent: number | null; /** whether a rise is good news, bad news, or neither */ goodWhenUp: boolean | null };

export function compareDays(now: Daybook, before: Daybook): CompareRow[] {
  const row = (key: string, label: string, a: number, b: number, goodWhenUp: boolean | null): CompareRow => ({
    key,
    label,
    now: a,
    before: b,
    change: round2(a - b),
    percent: Math.abs(b) < 0.005 ? null : round2(((a - b) / Math.abs(b)) * 100),
    goodWhenUp,
  });
  return [
    row("sales", "Sales", now.sales.total, before.sales.total, true),
    row("purchases", "Purchases", now.purchases.total, before.purchases.total, null),
    row("expenses", "Expenses", now.expenses.total, before.expenses.total, false),
    row("in", "Money in", now.moneyIn, before.moneyIn, true),
    row("out", "Money out", now.moneyOut, before.moneyOut, null),
  ];
}

// ---- Credit given and taken ----

const onCredit = (s: DocSection) => s.byMode.find((m) => m.mode === ON_CREDIT)?.amount ?? 0;

/** Sold and not yet paid (customers owe you more), and bought or spent and not yet paid (you owe more). */
export function creditOfDay(d: Daybook): { given: number; taken: number } {
  return { given: round2(onCredit(d.sales)), taken: round2(onCredit(d.purchases) + onCredit(d.expenses)) };
}

// ---- Everything entered that day ----

export type ListEntry = DayEntry & { reference: string | null; memo: string | null; createdAt: string };
export type ListRow = { id: string; time: string; kind: string; reference: string; note: string; amount: number; /** an older entry corrected or undone on this day, or the undo itself */ correction: boolean };

const KIND: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  expense: "Expense",
  receipt: "Money in",
  payment: "Money out",
  payroll: "Payroll",
  asset_purchase: "Asset bought",
  asset_disposal: "Asset sold",
  asset_writeoff: "Asset written off",
  sales_return: "Sales return",
  purchase_return: "Purchase return",
  bank_adjustment: "Bank charge or interest",
  tax_assessment: "Tax charge",
  opening_balance: "Opening balance",
  advance_application: "Advance applied",
  stock_adjustment: "Stock adjustment",
  inter_transfer: "Transfer",
  manual: "Manual entry",
};
const DOCUMENT = new Set(["sale", "purchase", "expense"]);

/** The day's entries, oldest first. An entry and its undo on the same day cancel and are left out, as in the totals. */
export function buildDayList(entries: ListEntry[], cashIds: Set<string>, limit = 300): { rows: ListRow[]; hidden: number } {
  const onDay = new Set(entries.map((e) => e.id));
  const cancelled = new Set<string>();
  for (const e of entries) if (e.reversalOfId && onDay.has(e.reversalOfId)) { cancelled.add(e.id); cancelled.add(e.reversalOfId); }
  const rows = entries
    .filter((e) => !cancelled.has(e.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((e): ListRow => {
      const debit = e.lines.reduce((s, l) => s + l.debit, 0);
      const cash = e.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0);
      const amount = DOCUMENT.has(e.sourceType) ? debit : e.sourceType === "inter_transfer" ? e.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s + l.debit, 0) : Math.abs(cash) > 0.004 ? Math.abs(cash) : debit;
      return {
        id: e.id,
        time: e.createdAt,
        kind: KIND[e.sourceType] ?? "Entry",
        reference: e.reference ?? "",
        note: e.memo ?? "",
        amount: round2(amount),
        correction: e.isReversed || e.reversalOfId !== null,
      };
    });
  return { rows: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) };
}
