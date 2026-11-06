// Late-deposit fines and interest on TDS, worked out heading by heading (no database, safe for the browser). It uses the penalty engine's own TDS
// formula, so one heading depositing everything on one day gives exactly what the single-figure calculator gives. The rates are the platform's
// TDS fine rules in force on the item's due date; nothing here hard-codes a number.
//
// What is charged on what:
//   - the filing fee (a yearly percentage of the amount withheld, accruing daily) and the interest are on each amount, for the days it was late,
//     so each heading carries its own;
//   - the flat daily administrative fine belongs to the return, not to a heading, so it is charged once, for as long as any amount stayed
//     unpaid, and shared between the headings by how much of each was late.

import { calculatePenalty, daysDelayed, type TdsPenaltyParams } from "./penalty-engine";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** An amount deposited (or still owed, counted to the date of the report) and the day it counts to. */
export type Tranche = { amount: number; date: string };

export type HeadFine = {
  /** The longest any amount of this heading was late, in days. */
  daysLate: number;
  /** This heading's share of the flat daily fine for the late return. */
  flat: number;
  /** The filing fee on the late amounts. */
  volumeFee: number;
  interest: number;
  total: number;
};

/**
 * What a heading owes or has paid, as amounts and the dates they count to: each deposit on the day it was paid (never more than was withheld in
 * all, earliest first), and whatever is still owed counted to `asOf`.
 */
export function tranchesFor(withheld: number, deposits: Tranche[], asOf: string): Tranche[] {
  const out: Tranche[] = [];
  let left = round2(withheld);
  for (const d of [...deposits].sort((a, b) => a.date.localeCompare(b.date))) {
    if (left <= 0.004) break;
    const amount = round2(Math.min(d.amount, left));
    if (amount > 0) out.push({ amount, date: d.date });
    left = round2(left - amount);
  }
  if (left > 0.004) out.push({ amount: left, date: asOf });
  return out;
}

const NO_FLAT: Pick<TdsPenaltyParams, "filingFlatPerDay"> = { filingFlatPerDay: 0 };

/** Fines and interest for each heading of one deposit item. `heads` are the headings' tranches; the due date is the item's statutory due date. */
export function tdsFinesByHeading(heads: { key: string | null; tranches: Tranche[] }[], dueDate: string, params: TdsPenaltyParams): Map<string | null, HeadFine> {
  // The return was late for as long as any amount stayed unpaid: that decides the flat fine, charged once.
  const lateDays = Math.max(0, ...heads.flatMap((h) => h.tranches.map((t) => daysDelayed(dueDate, t.date))));
  const flatTotal = round2(params.filingFlatPerDay * lateDays);
  const lateAmount = (h: { tranches: Tranche[] }) => round2(h.tranches.filter((t) => daysDelayed(dueDate, t.date) > 0).reduce((s, t) => s + t.amount, 0));
  const lateTotal = heads.reduce((s, h) => s + lateAmount(h), 0);

  const out = new Map<string | null, HeadFine>();
  let allocated = 0;
  const late = heads.filter((h) => lateAmount(h) > 0);
  heads.forEach((h) => {
    let volumeFee = 0;
    let interest = 0;
    let daysLate = 0;
    for (const t of h.tranches) {
      const b = calculatePenalty("tds", t.amount, dueDate, t.date, { ...params, ...NO_FLAT });
      volumeFee = round2(volumeFee + b.filingPenalty);
      interest = round2(interest + b.interest);
      daysLate = Math.max(daysLate, b.daysDelayed);
    }
    const isLastLate = late.length > 0 && late[late.length - 1] === h;
    // Shared by late amount; the last heading takes the rounding remainder so the shares always add up to the flat fine exactly.
    const flat = lateTotal > 0 && lateAmount(h) > 0 ? (isLastLate ? round2(flatTotal - allocated) : round2((flatTotal * lateAmount(h)) / lateTotal)) : 0;
    if (flat > 0 || lateAmount(h) > 0) allocated = round2(allocated + flat);
    out.set(h.key, { daysLate, flat, volumeFee, interest, total: round2(flat + volumeFee + interest) });
  });
  return out;
}

export const sumFines = (fines: HeadFine[]): HeadFine => ({
  daysLate: Math.max(0, ...fines.map((f) => f.daysLate)),
  flat: round2(fines.reduce((s, f) => s + f.flat, 0)),
  volumeFee: round2(fines.reduce((s, f) => s + f.volumeFee, 0)),
  interest: round2(fines.reduce((s, f) => s + f.interest, 0)),
  total: round2(fines.reduce((s, f) => s + f.total, 0)),
});
