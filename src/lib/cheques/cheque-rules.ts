// Issued cheques: what state a cheque is in, what it would settle, and the checks before it is written down. Pure rules, no database.

export type ChequeStatus = "issued" | "cleared" | "bounced" | "stopped";
export type PayeeKind = "supplier" | "expense";

/** A cheque can be presented for this long after its date. Six months is the usual rule; after that it is stale and the bank may refuse it. */
export const VALID_DAYS = 180;

export type ChequeRow = { status: ChequeStatus; chequeDate: string; amount: number };

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What to call a cheque today: still to come, ready to present, past its validity, or finished. */
export type ChequeView = "post_dated" | "due" | "stale" | "cleared" | "bounced" | "stopped";

export function viewOf(c: Pick<ChequeRow, "status" | "chequeDate">, today: string): ChequeView {
  if (c.status === "cleared") return "cleared";
  if (c.status === "bounced") return "bounced";
  if (c.status === "stopped") return "stopped";
  if (c.chequeDate > today) return "post_dated";
  if (today > addDays(c.chequeDate, VALID_DAYS)) return "stale";
  return "due";
}

export const VIEW_LABEL: Record<ChequeView, string> = { post_dated: "Post-dated", due: "Due", stale: "Stale", cleared: "Cleared", bounced: "Bounced", stopped: "Stopped" };

/** The last day a cheque can be presented. */
export const lastValidDay = (chequeDate: string) => addDays(chequeDate, VALID_DAYS);

/** The next number in a cheque book: the highest number written so far, plus one, keeping its length ("004512" gives "004513"). */
export function nextChequeNumber(existing: string[]): string {
  let best: { value: number; width: number } | null = null;
  for (const raw of existing) {
    const m = /(\d+)\s*$/.exec(raw.trim());
    if (!m) continue;
    const value = Number(m[1]);
    if (!best || value > best.value) best = { value, width: m[1].length };
  }
  return best ? String(best.value + 1).padStart(best.width, "0") : "";
}

export type ChequeInput = {
  bankAccountId: string;
  chequeNumber: string;
  payeeKind: PayeeKind;
  vendorId: string | null;
  expenseId: string | null;
  amount: number;
  issueDate: string;
  chequeDate: string;
  memo: string | null;
  replacesId: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The first thing wrong with a cheque, in plain words, or null when it can be written down. */
export function validateCheque(i: ChequeInput, today: string): string | null {
  if (!i.bankAccountId) return "Choose the bank account the cheque is drawn on.";
  if (!i.chequeNumber.trim()) return "Enter the cheque number.";
  if (i.chequeNumber.trim().length > 30) return "The cheque number is too long.";
  if (i.payeeKind !== "supplier" && i.payeeKind !== "expense") return "Choose who the cheque is for.";
  if (i.payeeKind === "supplier" && !i.vendorId) return "Choose the supplier.";
  if (i.payeeKind === "expense" && !i.expenseId) return "Choose the expense this cheque pays.";
  if (!Number.isFinite(i.amount) || i.amount <= 0) return "Enter the amount of the cheque.";
  if (!ISO.test(i.issueDate) || !ISO.test(i.chequeDate)) return "Choose the dates.";
  if (i.issueDate > today) return "The issue date cannot be in the future. Use the cheque date for a post-dated cheque.";
  if (i.chequeDate < i.issueDate) return "The cheque date cannot be before the day it was issued.";
  if (i.chequeDate > addDays(today, 365)) return "A cheque dated more than a year ahead is probably a mistake.";
  if (i.memo && i.memo.length > 300) return "The note is too long.";
  return null;
}

/** A date to clear on must be a real day that is not in the future, and not before the date on the cheque. */
export function validateClearDate(clearedDate: string, chequeDate: string, today: string): string | null {
  if (!ISO.test(clearedDate)) return "Choose the date the cheque cleared.";
  if (clearedDate > today) return "A cheque cannot have cleared on a future date.";
  if (clearedDate < chequeDate) return "A cheque cannot clear before the date written on it.";
  return null;
}

export type OpenBill = { number: string; date: string; outstanding: number };

/**
 * What clearing a supplier cheque would settle. Payments to a supplier go on their own ledger and settle their bills oldest first;
 * anything beyond what they are owed stays with them as an advance.
 */
export function settlementPreview(bills: OpenBill[], amount: number): { settles: { number: string; amount: number; full: boolean }[]; advance: number } {
  let left = round2(amount);
  const settles: { number: string; amount: number; full: boolean }[] = [];
  for (const b of [...bills].sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : a.number < c.number ? -1 : 1))) {
    if (left <= 0) break;
    const take = round2(Math.min(left, b.outstanding));
    if (take <= 0) continue;
    settles.push({ number: b.number, amount: take, full: take >= b.outstanding - 0.005 });
    left = round2(left - take);
  }
  return { settles, advance: Math.max(left, 0) };
}

export type ChequeSummary = {
  outstanding: { count: number; amount: number };
  /** Cheques that can be presented now (or already could). */
  dueNow: { count: number; amount: number };
  /** Falling in the next 7 days, including today and any already due. */
  thisWeek: { count: number; amount: number };
  /** Still more than 30 days away. */
  later: { count: number; amount: number };
  stale: { count: number; amount: number };
};

const zero = () => ({ count: 0, amount: 0 });

/** The figures at the top of the register, for the cheques still waiting to clear. */
export function summarize(cheques: ChequeRow[], today: string): ChequeSummary {
  const s: ChequeSummary = { outstanding: zero(), dueNow: zero(), thisWeek: zero(), later: zero(), stale: zero() };
  const add = (bucket: { count: number; amount: number }, amount: number) => {
    bucket.count += 1;
    bucket.amount = round2(bucket.amount + amount);
  };
  for (const c of cheques) {
    if (c.status !== "issued") continue;
    add(s.outstanding, c.amount);
    const view = viewOf(c, today);
    if (view === "stale") add(s.stale, c.amount);
    if (view === "due" || view === "stale") add(s.dueNow, c.amount);
    const away = daysBetween(today, c.chequeDate);
    if (away <= 7) add(s.thisWeek, c.amount);
    if (away > 30) add(s.later, c.amount);
  }
  return s;
}
