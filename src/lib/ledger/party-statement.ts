// Pure party-ledger arithmetic (no database), unit-tested.
// A customer's or supplier's position is what the LEDGER says about their own
// sub-account (Accounts Receivable / Payable sub-account), not a tally of
// invoices and payments. That way everything posted to it — invoices, payments,
// the opening balance, and manual journal vouchers — shows up in one place and
// agrees with the Chart of Accounts.

export type PartyLine = {
  date: string;
  debit: number;
  credit: number;
  sourceType: string;
  reference: string | null;
  memo: string | null;
  isReversal: boolean;
};

/** "debit" for customers (receivable), "credit" for suppliers (payable). */
export type Normal = "debit" | "credit";
export type LineKind = "opening" | "invoice" | "payment" | "other";

export function lineKind(sourceType: string): LineKind {
  if (sourceType === "opening_balance") return "opening";
  if (sourceType === "sale" || sourceType === "purchase") return "invoice";
  if (sourceType === "payment" || sourceType === "receipt") return "payment";
  return "other";
}

/** The line's effect on the party's balance, signed to the normal side (positive = balance grows). */
export const effect = (l: Pick<PartyLine, "debit" | "credit">, normal: Normal) => (normal === "debit" ? l.debit - l.credit : l.credit - l.debit);

const round2 = (n: number) => Math.round(n * 100) / 100;

export function describeLine(l: PartyLine): string {
  const kind = lineKind(l.sourceType);
  let label: string;
  if (l.sourceType === "sale") label = `Sales invoice${l.reference ? ` ${l.reference}` : ""}`;
  else if (l.sourceType === "sales_return") label = `Debit note (sales return)${l.reference ? ` ${l.reference}` : ""}`;
  else if (l.sourceType === "purchase_return") label = `Credit note (purchase return)${l.reference ? ` ${l.reference}` : ""}`;
  else if (l.sourceType === "purchase") label = `Purchase bill${l.reference ? ` ${l.reference}` : ""}`;
  else if (kind === "payment") label = l.sourceType === "receipt" ? "Payment received" : "Payment made";
  else if (kind === "opening") label = "Opening balance";
  else if (l.sourceType === "manual") label = `Journal voucher${l.reference ? ` ${l.reference}` : ""}${l.memo ? ` — ${l.memo}` : ""}`;
  else label = l.memo || l.sourceType.replace(/_/g, " ");
  return l.isReversal ? `Reversal — ${label}` : label;
}

/** The party's lines split the way the screens present them: the opening balance, invoices/bills, payments, and anything else. */
export function partyBuckets(lines: readonly PartyLine[], normal: Normal) {
  const out = { opening: 0, invoices: [] as { date: string; total: number }[], payments: [] as { date: string; amount: number }[], others: [] as { date: string; amount: number }[] };
  for (const l of lines) {
    const e = effect(l, normal);
    switch (lineKind(l.sourceType)) {
      case "opening":
        out.opening += e;
        break;
      case "invoice":
        out.invoices.push({ date: l.date, total: round2(e) });
        break;
      case "payment":
        out.payments.push({ date: l.date, amount: round2(-e) }); // a payment reduces the balance
        break;
      default:
        out.others.push({ date: l.date, amount: round2(e) });
    }
  }
  out.opening = round2(out.opening);
  return out;
}

export type StatementRow = { date: string; details: string; debit: number; credit: number; balance: number };

/**
 * The party's ledger for a period: an opening balance (the opening-balance entry plus everything
 * before `from`), the movements in the period with a running balance, and the closing balance.
 */
export function buildStatement(lines: readonly PartyLine[], normal: Normal, range: { from?: string; to?: string } = {}) {
  const { from, to } = range;
  const beforeFrom = (d: string) => !!from && d < from;
  const inRange = (d: string) => !(from && d < from) && !(to && d > to);

  let opening = 0;
  for (const l of lines) if (lineKind(l.sourceType) === "opening" || beforeFrom(l.date)) opening += effect(l, normal);
  opening = round2(opening);

  let running = opening;
  const rows: StatementRow[] = [];
  for (const l of lines) {
    if (lineKind(l.sourceType) === "opening" || !inRange(l.date)) continue;
    running = round2(running + effect(l, normal));
    rows.push({ date: l.date, details: describeLine(l), debit: l.debit, credit: l.credit, balance: running });
  }
  return { openingBalance: opening, closingBalance: running, rows };
}
