import { findCombination, type CombinationEntry } from "@/lib/banking/combinations";

// Reconciling a supplier's statement against our supplier account, without a database. Both sides are reduced to the same thing: a line with a date, a
// reference and an EFFECT on what we owe the supplier (positive = a bill that adds to it, negative = a payment or credit that reduces it).

export type Orientation = "credit_is_bill" | "debit_is_bill";
export type Line = { id: string; date: string; reference: string; description: string; effect: number };
export type MatchKind = "reference" | "reference_diff" | "amount_date" | "combination";
export type MatchGroup = { kind: MatchKind; /** True only for a match that needs no one's OK (the same document number and amount). */ auto: boolean; theirIds: string[]; ourIds: string[] };
export type Tolerances = { dateDays: number; amount: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const cents = (n: number) => Math.round(n * 100);
const dayGap = (a: string, b: string) => Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000;

/** What a statement row does to what we owe, given which way round the statement is written. `amount` is credit minus debit, as the bank-statement reader gives it. */
export const effectOf = (amount: number, orientation: Orientation) => round2(orientation === "credit_is_bill" ? amount : -amount);

/**
 * Which way round a statement is written, from its running balance: the balance rises with a credit when a credit is a bill to us, and with a debit when the
 * statement is the supplier's own book. Counts the rows each reading explains; a tie, or no balance column, takes the usual reading.
 */
export function detectOrientation(rows: { amount: number; balance: number | null }[]): Orientation {
  let credit = 0;
  let debit = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].balance;
    const b = rows[i].balance;
    if (a === null || b === null) continue;
    const step = cents(b - a);
    if (step === cents(rows[i].amount)) credit++;
    else if (step === -cents(rows[i].amount)) debit++;
  }
  return debit > credit ? "debit_is_bill" : "credit_is_bill";
}

/** The balance the statement starts from and ends on (positive = we owe them): read from its balance column, or built up from the rows when there is none. */
export function statementBalances(rows: { amount: number; balance: number | null }[], orientation: Orientation): { opening: number; closing: number } {
  const withBalance = rows.filter((r) => r.balance !== null);
  if (withBalance.length > 0 && rows[0].balance !== null) {
    const opening = round2((rows[0].balance as number) - effectOf(rows[0].amount, orientation));
    const last = [...rows].reverse().find((r) => r.balance !== null)!;
    return { opening, closing: round2(last.balance as number) };
  }
  return { opening: 0, closing: round2(rows.reduce((s, r) => s + effectOf(r.amount, orientation), 0)) };
}

const normRef = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Two document numbers that mean the same thing: equal once punctuation is gone, or one holds the other (INV-1042 and 1042/2083 do not, B-218 and 218 do not: too short to trust). */
export function refsAgree(a: string, b: string): boolean {
  const x = normRef(a);
  const y = normRef(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Pairs up the two sides, strongest evidence first. The same document number and amount is certain; everything else (a document number with a different
 * amount, the same amount near the same date, several lines adding up to one) is only suggested and waits for the person's OK. A line is used once.
 */
export function matchLedgers(theirs: Line[], ours: Line[], tol: Tolerances): { groups: MatchGroup[]; theirsOnly: string[]; oursOnly: string[] } {
  const tolCents = cents(tol.amount);
  const usedT = new Set<string>();
  const usedO = new Set<string>();
  const groups: MatchGroup[] = [];
  const free = (l: Line, used: Set<string>) => !used.has(l.id);
  const sameSide = (a: Line, b: Line) => Math.sign(a.effect) === Math.sign(b.effect);
  const byDate = [...theirs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const take = (kind: MatchKind, auto: boolean, theirIds: string[], ourIds: string[]) => {
    theirIds.forEach((i) => usedT.add(i));
    ourIds.forEach((i) => usedO.add(i));
    groups.push({ kind, auto, theirIds: [...theirIds].sort(), ourIds: [...ourIds].sort() });
  };

  // 1. The same document number and the same amount.
  for (const t of byDate) {
    if (!free(t, usedT)) continue;
    const c = ours.filter((o) => free(o, usedO) && sameSide(t, o) && refsAgree(t.reference, o.reference) && Math.abs(cents(t.effect) - cents(o.effect)) <= tolCents).sort((a, b) => dayGap(a.date, t.date) - dayGap(b.date, t.date))[0];
    if (c) take("reference", true, [t.id], [c.id]);
  }
  // 2. The same document number but not the same amount (tax withheld, a short payment): likely, and the difference is shown.
  for (const t of byDate) {
    if (!free(t, usedT)) continue;
    const c = ours.filter((o) => free(o, usedO) && sameSide(t, o) && refsAgree(t.reference, o.reference)).sort((a, b) => dayGap(a.date, t.date) - dayGap(b.date, t.date))[0];
    if (c) take("reference_diff", false, [t.id], [c.id]);
  }
  // 3. The same amount near the same date.
  for (const t of byDate) {
    if (!free(t, usedT)) continue;
    const c = ours
      .filter((o) => free(o, usedO) && sameSide(t, o) && Math.abs(cents(t.effect) - cents(o.effect)) <= tolCents && dayGap(t.date, o.date) <= tol.dateDays)
      .sort((a, b) => dayGap(a.date, t.date) - dayGap(b.date, t.date) || Math.abs(a.effect - t.effect) - Math.abs(b.effect - t.effect))[0];
    if (c) take("amount_date", false, [t.id], [c.id]);
  }
  // 4. Several lines on one side adding up to one line on the other (a single receipt for three bills).
  const window = Math.max(tol.dateDays, 10);
  const entries = (list: Line[], used: Set<string>, near: string): CombinationEntry[] => list.filter((l) => free(l, used) && dayGap(l.date, near) <= window).map((l) => ({ id: l.id, cents: cents(l.effect), date: l.date }));
  for (const t of byDate) {
    if (!free(t, usedT)) continue;
    const set = findCombination(entries(ours, usedO, t.date), cents(t.effect), t.date);
    if (set) take("combination", false, [t.id], set);
  }
  for (const o of [...ours].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!free(o, usedO)) continue;
    const set = findCombination(entries(theirs, usedT, o.date), cents(o.effect), o.date);
    if (set) take("combination", false, set, [o.id]);
  }

  return { groups, theirsOnly: theirs.filter((t) => !usedT.has(t.id)).map((t) => t.id), oursOnly: ours.filter((o) => !usedO.has(o.id)).map((o) => o.id) };
}

export type Proof = {
  /** Our balance less theirs (positive = our books say we owe more). */
  difference: number;
  /** The four parts the difference is made of; they always add up to it. */
  openingDifference: number;
  matchedDifference: number;
  oursOnly: number;
  theirsOnly: number;
};

/**
 * What the difference between the two closing balances is made of: the difference at the start, the amounts that don't agree on matched lines, what is
 * only in our books, and what is only on their statement. Every line is on one of the two sides, so the parts add up to the difference exactly.
 */
export function proof(input: { ourOpening: number; ourClosing: number; theirOpening: number; theirClosing: number; theirs: Line[]; ours: Line[]; groups: MatchGroup[] }): Proof {
  const t = new Map(input.theirs.map((l) => [l.id, l.effect]));
  const o = new Map(input.ours.map((l) => [l.id, l.effect]));
  let matchedDifference = 0;
  const matchedT = new Set<string>();
  const matchedO = new Set<string>();
  for (const g of input.groups) {
    matchedDifference += g.ourIds.reduce((s, id) => s + (o.get(id) ?? 0), 0) - g.theirIds.reduce((s, id) => s + (t.get(id) ?? 0), 0);
    g.theirIds.forEach((id) => matchedT.add(id));
    g.ourIds.forEach((id) => matchedO.add(id));
  }
  const oursOnly = input.ours.filter((l) => !matchedO.has(l.id)).reduce((s, l) => s + l.effect, 0);
  const theirsOnly = input.theirs.filter((l) => !matchedT.has(l.id)).reduce((s, l) => s + l.effect, 0);
  return {
    difference: round2(input.ourClosing - input.theirClosing),
    openingDifference: round2(input.ourOpening - input.theirOpening),
    matchedDifference: round2(matchedDifference),
    oursOnly: round2(oursOnly),
    theirsOnly: round2(theirsOnly),
  };
}

/** The reconciliation statement: from our balance to theirs. Returns the rows with their signed effect, ending on the balance the supplier's statement should show. */
export function bridge(ourClosing: number, p: Proof): { label: string; amount: number }[] {
  return [
    { label: "Opening difference", amount: round2(-p.openingDifference) },
    { label: "Amounts that differ on matched lines", amount: round2(-p.matchedDifference) },
    { label: "In our books only", amount: round2(-p.oursOnly) },
    { label: "On their statement only", amount: round2(p.theirsOnly) },
  ].filter((r) => r.amount !== 0).concat([{ label: "Balance on their statement", amount: round2(ourClosing - p.openingDifference - p.matchedDifference - p.oursOnly + p.theirsOnly) }]);
}
