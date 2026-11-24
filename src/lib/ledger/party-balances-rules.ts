// Trade payables and trade receivables: for every supplier (or customer), what was owed at the start of the period, what moved, and what is owed at the end.
// Pure (no database), so the rules can be tested on their own. The figures come from each party's own ledger account, the same lines the statements use, so
// the closing agrees with the Supplier / Customer Statement and with the Chart of Accounts.

import { describeLine, effect, lineKind, type Normal, type PartyLine } from "./party-statement";

export type Bucket = "inv" | "pay" | "ret" | "other";

export type PartyInput = { id: string; name: string; lines: PartyLine[] };

/** One entry behind the figures: its effect on the balance (positive = owed more), and the balance after it. */
export type PartyEntry = { entryId: string; date: string; reference: string | null; details: string; bucket: Bucket; amount: number; balance: number; isReversal: boolean; isReversed: boolean; reversalOfId: string | null };

export type PartyRow = {
  id: string;
  name: string;
  opening: number;
  /** Bills (purchases) or invoices (credit sales), less any that were voided. */
  inv: number;
  /** Payments made or received, as a reduction of what is owed. */
  pay: number;
  ret: number;
  /** Anything else posted to the account (journal vouchers, adjustments). */
  other: number;
  closing: number;
  entries: PartyEntry[];
  /** Voided or edited entries, and the entries that reversed them, left out of `entries` because they cancel. */
  hiddenPairs: number;
  /** Has a balance at either end of the period, or an entry in it. */
  active: boolean;
};

export type PartyTotals = Pick<PartyRow, "opening" | "inv" | "pay" | "ret" | "other" | "closing">;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function bucketOf(sourceType: string, normal: Normal): Bucket {
  const kind = lineKind(sourceType);
  if (kind === "invoice") return "inv";
  if (kind === "payment") return "pay";
  if (sourceType === (normal === "credit" ? "purchase_return" : "sales_return")) return "ret";
  return "other";
}

export function buildPartyRow(party: PartyInput, normal: Normal, range: { from: string; to: string }): PartyRow {
  let opening = 0;
  const inRange: { line: PartyLine; amount: number; bucket: Bucket }[] = [];
  for (const l of party.lines) {
    const e = effect(l, normal);
    if (lineKind(l.sourceType) === "opening" || l.date < range.from) opening += e;
    else if (l.date <= range.to) inRange.push({ line: l, amount: e, bucket: bucketOf(l.sourceType, normal) });
  }
  opening = round2(opening);

  const sums: Record<Bucket, number> = { inv: 0, pay: 0, ret: 0, other: 0 };
  for (const x of inRange) sums[x.bucket] += x.amount;

  // A void or an edit reverses an entry with a mirror entry; when both are in the period they cancel and are left out of the list (the totals above include
  // both, so they still add up). A pair split by the edge of the period stays, because the opening balance already holds the original.
  const ids = new Set(inRange.map((x) => x.line.entryId));
  const hidden = new Set<string>();
  const pairs = new Set<string>();
  for (const x of inRange) {
    const of = x.line.reversalOfId;
    if (of && ids.has(of) && x.line.entryId) {
      hidden.add(x.line.entryId);
      hidden.add(of);
      pairs.add(of);
    }
  }
  let running = opening;
  const entries: PartyEntry[] = [];
  for (const x of inRange) {
    if (x.line.entryId && hidden.has(x.line.entryId)) continue;
    running = round2(running + x.amount);
    entries.push({
      entryId: x.line.entryId ?? "",
      date: x.line.date,
      reference: x.line.reference,
      details: describeLine(x.line),
      bucket: x.bucket,
      amount: round2(x.amount),
      balance: running,
      isReversal: x.line.isReversal,
      isReversed: Boolean(x.line.isReversed),
      reversalOfId: x.line.reversalOfId ?? null,
    });
  }

  const row: PartyRow = {
    id: party.id,
    name: party.name,
    opening,
    inv: round2(sums.inv),
    pay: round2(sums.pay),
    ret: round2(sums.ret),
    other: round2(sums.other),
    closing: round2(opening + sums.inv + sums.pay + sums.ret + sums.other),
    entries,
    hiddenPairs: pairs.size,
    active: false,
  };
  row.active = row.opening !== 0 || row.closing !== 0 || entries.length > 0;
  return row;
}

export function totalsOf(rows: PartyRow[]): PartyTotals {
  const sum = (k: keyof PartyTotals) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { opening: sum("opening"), inv: sum("inv"), pay: sum("pay"), ret: sum("ret"), other: sum("other"), closing: sum("closing") };
}

/** Rows ordered by name, or by what is owed (largest first). */
export function sortRows<T extends Pick<PartyRow, "name" | "closing">>(rows: T[], by: "name" | "closing"): T[] {
  return [...rows].sort((a, b) => (by === "closing" ? b.closing - a.closing || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));
}

/** What the entries of one kind add up to. */
export const entriesTotal = (entries: PartyEntry[]) => round2(entries.reduce((s, e) => s + e.amount, 0));

// ------------------------------------------------------------------ the ledger's own figure

export type ControlCheck = {
  /** What the control account (Accounts Payable / Receivable) and every account under it hold at the end of the period. */
  ledger: number;
  /** What the parties add up to, including any that are not shown. */
  parties: number;
  /** The ledger less the parties: entries posted to the control account itself, not to a supplier or customer. Zero when all agree. */
  difference: number;
  balanced: boolean;
};

export function controlCheck(ledger: number, partiesClosing: number): ControlCheck {
  const difference = round2(ledger - partiesClosing);
  return { ledger: round2(ledger), parties: round2(partiesClosing), difference, balanced: Math.abs(difference) < 0.005 };
}
