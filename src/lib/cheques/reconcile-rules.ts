// Matching a bank statement line to a cheque that has not cleared in the books yet. Pure rules, no database.
// A cheque in the register is not posted until the bank pays it, so the line on the statement is what proves it cleared.

import { VALID_DAYS, addDays } from "./cheque-rules";

export type ChequeCandidate = {
  kind: "issued" | "received";
  chequeId: string;
  chequeNumber: string;
  /** The payee (issued) or the customer who gave it (received). */
  party: string;
  amount: number;
  chequeDate: string;
  score: number;
  tier: "exact" | "suggested";
  /** Why it looks right, in plain words. */
  reasons: string[];
};

export type StatementLineInput = { date: string; amount: number; description: string; reference: string };

export type ChequeInput = { kind: "issued" | "received"; number: string; amount: number; chequeDate: string; depositedDate?: string | null };

/** The digits of a cheque number without leading zeros: "004512" and "4512" are the same cheque. */
const digitsOf = (s: string) => {
  const m = /(\d+)\s*$/.exec(s.trim());
  return m ? m[1].replace(/^0+/, "") : "";
};

/**
 * Whether a bank line's text names this cheque. Banks write it in many ways ("CHQ 004512", "CLG CHQ NO 4512", "Chq-4512"), so the
 * digits are compared as numbers. Very short numbers are not trusted on their own, because they turn up in dates and amounts.
 */
export function mentionsCheque(text: string, chequeNumber: string): boolean {
  const want = digitsOf(chequeNumber);
  if (want.length < 3) return false;
  for (const m of text.matchAll(/\d+/g)) {
    if (m[0].replace(/^0+/, "") === want) return true;
  }
  return false;
}

/**
 * How well a statement line fits a cheque, or null when it cannot be the one. It must be the same amount in the right direction (money
 * out for a cheque we wrote, money in for one we were given), no earlier than the date on the cheque, and not after the cheque went stale.
 */
export function scoreChequeCandidate(line: StatementLineInput, c: ChequeInput): { score: number; tier: "exact" | "suggested"; reasons: string[] } | null {
  const out = c.kind === "issued";
  if (out ? line.amount >= 0 : line.amount <= 0) return null;
  if (Math.abs(Math.abs(line.amount) - c.amount) > 0.01) return null;
  if (line.date < c.chequeDate) return null;
  if (line.date > addDays(c.chequeDate, VALID_DAYS)) return null;
  if (c.depositedDate && line.date < c.depositedDate) return null;

  const reasons = ["Same amount"];
  let score = 55;
  if (mentionsCheque(`${line.description} ${line.reference}`, c.number)) {
    score += 35;
    reasons.push(`Cheque number ${c.number} is on the bank line`);
  }
  const days = Math.round((Date.parse(line.date + "T00:00:00Z") - Date.parse(c.chequeDate + "T00:00:00Z")) / 86_400_000);
  if (days <= 5) {
    score += 10;
    reasons.push(days === 0 ? "On the date written on the cheque" : `${days} ${days === 1 ? "day" : "days"} after the date on the cheque`);
  }
  score = Math.min(score, 100);
  return { score, tier: score >= 90 ? "exact" : "suggested", reasons };
}
