import { ON_CREDIT, type DayEntry, type Daybook, type DocSection } from "./daybook-rules";

// Daybook phase 2, the parts that read the day rather than add it up: the month so far, collections and payments, the credit given and taken
// that day, and the list of everything entered that day. Pure, like daybook-rules.ts.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- This month so far ----

/** The month's totals up to and including the day being looked at, in the organization's own calendar month. */
export type MonthTotals = { /** first day of the month */ from: string; sales: number; purchases: number; expenses: number; moneyIn: number; moneyOut: number };

// ---- Collections and payments ----

/** The standalone payments a business watches: customers paying what they owed, suppliers being paid, salaries and staff advances. Payments made with a sale or bill on the same day are already in that sale or bill. */
export const FLOW_TYPES = [
  { type: "customer_payment", key: "recovered", label: "Customer credit recovered" },
  { type: "supplier_payment", key: "suppliers", label: "Supplier payments" },
  { type: "salary_payment", key: "salary", label: "Salary paid" },
  { type: "staff_advance", key: "advances", label: "Staff advances given" },
] as const;
export type FlowRow = { key: string; label: string; today: number; month: number };

/** Puts the sums read from the payments in the fixed order, with zeros where there were none. */
export function flowRows(sums: { type: string; today: number; month: number }[]): FlowRow[] {
  return FLOW_TYPES.map((f) => {
    const s = sums.find((x) => x.type === f.type);
    return { key: f.key, label: f.label, today: round2(s?.today ?? 0), month: round2(s?.month ?? 0) };
  });
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
