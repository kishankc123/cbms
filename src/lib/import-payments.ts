import type { FieldDef } from "./import-columns";
import type { PaymentResolver } from "./payment-modes";
import { parseAmountCell } from "@/lib/sales/import/values";

// The payment columns of an imported invoice, bill or expense: up to three (amount, account) pairs, so one document can be paid
// in parts through different accounts (say part cash, part Fonepay). Shared by the three imports.

export const PAY_SLOTS = 3;
export type PayKey = "paid" | "account" | "paid2" | "account2" | "paid3" | "account3";
export type PayMode = "file" | "unpaid" | "full";

const slotKey = (kind: "paid" | "account", n: number) => (n === 1 ? kind : `${kind}${n}`) as PayKey;
const slotLabel = (label: string, n: number) => (n === 1 ? label : `${label} ${n}`);

export function payFields(accountLabel: string, paidHelp: string, accountHelp: string): FieldDef<PayKey>[] {
  return Array.from({ length: PAY_SLOTS }, (_, i) => i + 1).flatMap((n) => [
    { key: slotKey("paid", n), label: slotLabel("Paid amount", n), required: false, help: n === 1 ? paidHelp : "A second part of the payment, if it was paid in more than one way." },
    { key: slotKey("account", n), label: slotLabel(accountLabel, n), required: false, help: accountHelp },
  ]);
}

export type PaySlot = {
  amount: { value: number | null; invalid: boolean };
  /** The account named in the file: none given, found, or named but not a cash, bank or wallet account. */
  account: "none" | "ok" | "unknown";
  accountText: string;
  /** Replaces the usual "not one of your accounts" message, e.g. when a payment mode has several accounts. */
  accountNote?: string;
  accountId: string | null;
  modeId: string | null;
};

/** Reads the payment columns of one row. */
export function readPaySlots(cell: (key: PayKey) => string, resolver: PaymentResolver): PaySlot[] {
  return Array.from({ length: PAY_SLOTS }, (_, i) => i + 1).map((n) => {
    const accountText = cell(slotKey("account", n));
    const pick = accountText ? resolver.resolve(accountText) : null;
    const picked = pick && "accountId" in pick ? pick : null;
    return {
      amount: parseAmountCell(cell(slotKey("paid", n))),
      account: accountText === "" ? "none" : picked ? "ok" : "unknown",
      accountText,
      accountNote: pick && "ambiguous" in pick ? `"${accountText}" has more than one account (${pick.ambiguous.join(", ")}). Write the account name instead.` : undefined,
      accountId: picked?.accountId ?? null,
      modeId: picked?.modeId ?? null,
    };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What is paid on a row, and what is wrong with it. `verb` finishes "the money was ...": "received into" or "paid from". */
export function checkPayments(slots: PaySlot[], total: number, mode: PayMode, hasDefaultAccount: boolean, doc: string, verb: string) {
  const problems: { issue: "paid" | "account"; message: string }[] = [];
  let paid = 0;
  if (mode === "full") paid = total;
  else if (mode === "file") {
    slots.forEach((s, i) => {
      if (s.amount.invalid) problems.push({ issue: "paid", message: `${i === 0 ? "" : `Payment ${i + 1}: `}The paid amount isn't a number.` });
      else paid = round2(paid + Math.max(s.amount.value ?? 0, 0));
    });
  }
  if (paid > total + 0.004) problems.push({ issue: "paid", message: `The paid amount (${paid.toFixed(2)}) is more than the ${doc} total (${total.toFixed(2)}).` });
  slots.forEach((s, i) => {
    const carries = mode === "file" ? (s.amount.value ?? 0) > 0 : mode === "full" && i === 0;
    if (!carries) return;
    if (s.account === "unknown") problems.push({ issue: "account", message: s.accountNote ?? `"${s.accountText}" isn't one of your cash, bank or wallet accounts, or payment modes.` });
    else if (s.account === "none" && !hasDefaultAccount) problems.push({ issue: "account", message: `Choose the account the money was ${verb}.` });
  });
  return { paid, problems };
}

/** The payment lines to post: each part with its account (the default account where the file names none). */
export function paymentLines(slots: PaySlot[], total: number, mode: PayMode, defaults: { accountId: string | null; modeId?: string | null }) {
  const parts = mode === "full" ? [{ slot: slots[0], amount: total }] : mode === "file" ? slots.map((slot) => ({ slot, amount: round2(Math.max(slot.amount.value ?? 0, 0)) })) : [];
  return parts
    .map(({ slot, amount }) => ({ accountId: slot.accountId ?? defaults.accountId, amount, modeId: slot.accountId ? slot.modeId : slot.accountText ? null : defaults.modeId ?? null }))
    .filter((p): p is { accountId: string; amount: number; modeId: string | null } => p.amount > 0 && Boolean(p.accountId));
}
