// Cheques received from customers: what state one is in, and the checks before each step. Pure rules, no database.
// The same shape as issued cheques, with one extra step: a received cheque is held, then deposited, then cleared.

import { VALID_DAYS, addDays } from "./cheque-rules";

export type ReceivedStatus = "received" | "deposited" | "cleared" | "bounced" | "returned";

export type ReceivedRow = { status: ReceivedStatus; chequeDate: string; amount: number };

/** What to call a received cheque today. */
export type ReceivedView = "post_dated" | "ready" | "deposited" | "stale" | "cleared" | "bounced" | "returned";

export function receivedViewOf(c: Pick<ReceivedRow, "status" | "chequeDate">, today: string): ReceivedView {
  if (c.status === "cleared") return "cleared";
  if (c.status === "bounced") return "bounced";
  if (c.status === "returned") return "returned";
  if (c.status === "deposited") return "deposited";
  if (c.chequeDate > today) return "post_dated";
  if (today > addDays(c.chequeDate, VALID_DAYS)) return "stale";
  return "ready";
}

export const RECEIVED_LABEL: Record<ReceivedView, string> = {
  post_dated: "Post-dated",
  ready: "Ready to deposit",
  deposited: "Deposited",
  stale: "Stale",
  cleared: "Cleared",
  bounced: "Bounced",
  returned: "Returned to customer",
};

export type ReceivedInput = {
  customerId: string;
  drawerBank: string;
  chequeNumber: string;
  amount: number;
  receivedDate: string;
  chequeDate: string;
  memo: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The first thing wrong with a cheque being recorded as received, in plain words, or null when it can be saved. */
export function validateReceived(i: ReceivedInput, today: string): string | null {
  if (!i.customerId) return "Choose the customer who gave the cheque.";
  if (!i.drawerBank.trim()) return "Enter the bank the cheque is drawn on.";
  if (i.drawerBank.trim().length > 80) return "The bank name is too long.";
  if (!i.chequeNumber.trim()) return "Enter the cheque number.";
  if (i.chequeNumber.trim().length > 30) return "The cheque number is too long.";
  if (!Number.isFinite(i.amount) || i.amount <= 0) return "Enter the amount of the cheque.";
  if (!ISO.test(i.receivedDate) || !ISO.test(i.chequeDate)) return "Choose the dates.";
  if (i.receivedDate > today) return "The date received cannot be in the future.";
  if (i.chequeDate > addDays(today, 365)) return "A cheque dated more than a year ahead is probably a mistake.";
  if (i.chequeDate < addDays(i.receivedDate, -VALID_DAYS)) return "That cheque was already stale when it was received. The bank will not accept a cheque more than six months old.";
  if (i.memo && i.memo.length > 300) return "The note is too long.";
  return null;
}

/** A deposit is made on a real day, not in the future, and not before the date on the cheque or the day it was received. */
export function validateDeposit(depositedDate: string, c: { chequeDate: string; receivedDate: string }, today: string): string | null {
  if (!ISO.test(depositedDate)) return "Choose the date it was deposited.";
  if (depositedDate > today) return "A cheque cannot have been deposited on a future date.";
  if (depositedDate < c.chequeDate) return "A cheque cannot be deposited before the date written on it.";
  if (depositedDate < c.receivedDate) return "A cheque cannot be deposited before it was received.";
  if (depositedDate > addDays(c.chequeDate, VALID_DAYS)) return "That cheque was stale on that date. The bank would have refused it.";
  return null;
}

/** It clears on or after it was deposited (when there is a deposit date), and never before its own date or in the future. */
export function validateReceivedClear(clearedDate: string, c: { chequeDate: string; depositedDate: string | null }, today: string): string | null {
  if (!ISO.test(clearedDate)) return "Choose the date the cheque cleared.";
  if (clearedDate > today) return "A cheque cannot have cleared on a future date.";
  if (clearedDate < c.chequeDate) return "A cheque cannot clear before the date written on it.";
  if (c.depositedDate && clearedDate < c.depositedDate) return "A cheque cannot clear before it was deposited.";
  return null;
}

export type ReceivedSummary = {
  /** Held or deposited, not yet cleared. */
  waiting: { count: number; amount: number };
  /** Dated today or earlier and still in the drawer. */
  readyToDeposit: { count: number; amount: number };
  /** Dated in the future. */
  postDated: { count: number; amount: number };
  /** Handed to the bank, not yet cleared. */
  deposited: { count: number; amount: number };
  stale: { count: number; amount: number };
};

const zero = () => ({ count: 0, amount: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeReceived(cheques: ReceivedRow[], today: string): ReceivedSummary {
  const s: ReceivedSummary = { waiting: zero(), readyToDeposit: zero(), postDated: zero(), deposited: zero(), stale: zero() };
  const add = (b: { count: number; amount: number }, amount: number) => {
    b.count += 1;
    b.amount = round2(b.amount + amount);
  };
  for (const c of cheques) {
    if (c.status !== "received" && c.status !== "deposited") continue;
    add(s.waiting, c.amount);
    const v = receivedViewOf(c, today);
    if (v === "ready") add(s.readyToDeposit, c.amount);
    if (v === "post_dated") add(s.postDated, c.amount);
    if (v === "deposited") add(s.deposited, c.amount);
    if (v === "stale") add(s.stale, c.amount);
  }
  return s;
}
