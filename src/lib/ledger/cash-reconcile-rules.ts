import { describeLine } from "./party-statement";

// Reconciling a cash account against the cash that is really there. Pure rules, no database, so they are unit-tested.
// Cash is a debit-normal account: a debit is cash coming in, a credit is cash going out.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ReconcileMethod = "statement" | "ticking";

/** Whether a ledger account code is under Bank (1010). */
export const isBankLedgerCode = (code: string) => code.startsWith("1010");

/**
 * How an account is reconciled. Cash and wallet accounts always tick. A bank account uses its statement unless it was set to tick (the person has no
 * statement to upload); an account with nothing stored uses the statement.
 */
export const reconcileMethodOf = (ledgerCode: string, stored: string | null | undefined): ReconcileMethod => (isBankLedgerCode(ledgerCode) && stored !== "ticking" ? "statement" : "ticking");

/** The ledger account that short and excess cash is posted to. One account for both, so they net off. */
export const SHORT_EXCESS_CODE = "5930";
export const SHORT_EXCESS_NAME = "Cash Short and Excess";

export type CashLine = {
  /** The journal line (what is ticked) and its journal entry. */
  id: string;
  entryId: string;
  date: string;
  debit: number;
  credit: number;
  sourceType: string;
  reference: string | null;
  memo: string | null;
  isReversed: boolean;
  reversalOfId: string | null;
};

export const inOf = (l: Pick<CashLine, "debit" | "credit">) => round2(Math.max(l.debit - l.credit, 0));
export const outOf = (l: Pick<CashLine, "debit" | "credit">) => round2(Math.max(l.credit - l.debit, 0));
export const netOf = (l: Pick<CashLine, "debit" | "credit">) => round2(l.debit - l.credit);

export const describeCash = (l: CashLine) =>
  describeLine({ date: l.date, debit: l.debit, credit: l.credit, sourceType: l.sourceType, reference: l.reference, memo: l.memo, isReversal: l.reversalOfId !== null });

/**
 * What is left to reconcile at a date: every line posted up to then that no earlier reconciliation took. The opening-balance entry is not a line to tick;
 * it joins the opening figure. A void (or edit) and its reversal, when both are still open, cancel out and are left off; a reversal of something that was
 * already reconciled stays, since it is a real change.
 */
export function openLines(all: readonly CashLine[], reconciledIds: ReadonlySet<string>, asOf: string): { opening: number; lines: CashLine[] } {
  const pool = all.filter((l) => !reconciledIds.has(l.id) && l.date <= asOf);
  const entryIds = new Set(pool.map((l) => l.entryId));
  const reversedHere = new Set(pool.map((l) => l.reversalOfId).filter((x): x is string => Boolean(x)));
  let opening = 0;
  const lines: CashLine[] = [];
  for (const l of pool) {
    if (l.sourceType === "opening_balance") {
      opening += netOf(l);
      continue;
    }
    if (l.reversalOfId && entryIds.has(l.reversalOfId)) continue;
    if (reversedHere.has(l.entryId)) continue;
    lines.push(l);
  }
  return { opening: round2(opening), lines };
}

export function tickedTotals(lines: readonly CashLine[], tickedIds: ReadonlySet<string>) {
  let cashIn = 0;
  let cashOut = 0;
  for (const l of lines) {
    if (!tickedIds.has(l.id)) continue;
    cashIn += inOf(l);
    cashOut += outOf(l);
  }
  return { cashIn: round2(cashIn), cashOut: round2(cashOut) };
}

export type Settlement = {
  /** Opening plus what was ticked: what the books say should be there. */
  booksBefore: number;
  /** Counted minus the books (negative = short); null when nothing was counted. */
  difference: number | null;
  /** What gets posted to Cash short and excess: the difference when it is adjusted, otherwise 0. */
  adjustment: number;
  closing: number;
  kind: "counted" | "confirmed";
};

/** The closing balance and what, if anything, has to be posted. A count is what proves a difference, so an adjustment can't be made without one. */
export function settle(input: { opening: number; cashIn: number; cashOut: number; counted: number | null; adjust: boolean }): Settlement {
  const booksBefore = round2(input.opening + input.cashIn - input.cashOut);
  if (input.counted === null) {
    if (input.adjust) throw new Error("Count the cash first: a short or excess can only be adjusted against a count.");
    return { booksBefore, difference: null, adjustment: 0, closing: booksBefore, kind: "confirmed" };
  }
  const difference = round2(input.counted - booksBefore);
  if (input.adjust && Math.abs(difference) < 0.005) throw new Error("The count agrees with the books, so there is nothing to adjust.");
  return { booksBefore, difference, adjustment: input.adjust ? difference : 0, closing: input.adjust ? round2(input.counted) : booksBefore, kind: "counted" };
}

export type Explained = { adjustment: number; explained: number; remaining: number; state: "none" | "open" | "partly" | "explained" };

/** How much of a posted short or excess has been explained since. `explained` counts only explanations that still stand (an expense that was voided doesn't). */
export function explainState(adjustment: number, explained: number): Explained {
  const total = round2(Math.abs(adjustment));
  if (total === 0) return { adjustment, explained: 0, remaining: 0, state: "none" };
  const done = round2(Math.min(Math.max(explained, 0), total));
  const remaining = round2(total - done);
  return { adjustment, explained: done, remaining, state: remaining === 0 ? "explained" : done === 0 ? "open" : "partly" };
}

/** The journal lines that post a short or an excess: a short (negative) takes cash out and debits the account, an excess does the opposite. */
export function adjustmentLines(cashAccountId: string, shortExcessAccountId: string, adjustment: number, label: string) {
  const amount = round2(Math.abs(adjustment));
  return adjustment < 0
    ? [
        { accountId: shortExcessAccountId, debitAmount: amount, description: label },
        { accountId: cashAccountId, creditAmount: amount, description: label },
      ]
    : [
        { accountId: cashAccountId, debitAmount: amount, description: label },
        { accountId: shortExcessAccountId, creditAmount: amount, description: label },
      ];
}

/** Moving an explained amount out of Cash short and excess: a short found to be an expense is debited to it and credited here, an excess the other way. */
export function explanationLines(shortExcessAccountId: string, otherAccountId: string, adjustment: number, amount: number, label: string) {
  const a = round2(amount);
  return adjustment < 0
    ? [
        { accountId: otherAccountId, debitAmount: a, description: label },
        { accountId: shortExcessAccountId, creditAmount: a, description: label },
      ]
    : [
        { accountId: shortExcessAccountId, debitAmount: a, description: label },
        { accountId: otherAccountId, creditAmount: a, description: label },
      ];
}
