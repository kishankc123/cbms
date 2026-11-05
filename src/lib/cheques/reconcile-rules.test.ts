import { describe, expect, it } from "vitest";
import { mentionsCheque, scoreChequeCandidate, type ChequeInput, type StatementLineInput } from "./reconcile-rules";

describe("finding a cheque number on a bank line", () => {
  it("reads the number however the bank writes it", () => {
    expect(mentionsCheque("CLG CHQ NO 4512 HIMALAYAN", "004512")).toBe(true);
    expect(mentionsCheque("Chq-004512", "004512")).toBe(true);
    expect(mentionsCheque("CHQ 4512", "4512")).toBe(true);
  });

  it("does not take part of another number for it", () => {
    expect(mentionsCheque("Ref 14512", "004512")).toBe(false);
    expect(mentionsCheque("Transfer to Ram", "004512")).toBe(false);
  });

  it("does not trust a very short number on its own", () => {
    expect(mentionsCheque("Fee 12", "12")).toBe(false);
  });
});

describe("scoring a statement line against a cheque", () => {
  const issued: ChequeInput = { kind: "issued", number: "004512", amount: 85000, chequeDate: "2026-11-10" };
  const line = (over: Partial<StatementLineInput> = {}): StatementLineInput => ({ date: "2026-11-12", amount: -85000, description: "CLG CHQ 4512", reference: "", ...over });

  it("is an exact match when the amount, direction and cheque number agree", () => {
    const r = scoreChequeCandidate(line(), issued)!;
    expect(r.tier).toBe("exact");
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.reasons).toContain("Cheque number 004512 is on the bank line");
  });

  it("is only a suggestion with the same amount and no number", () => {
    const r = scoreChequeCandidate(line({ description: "Cheque clearing" }), issued)!;
    expect(r.tier).toBe("suggested");
    expect(r.score).toBeLessThan(90);
  });

  it("cannot be the one when the amount, direction or date is wrong", () => {
    expect(scoreChequeCandidate(line({ amount: -84000 }), issued)).toBeNull();
    expect(scoreChequeCandidate(line({ amount: 85000 }), issued)).toBeNull(); // money in, but we wrote this cheque
    expect(scoreChequeCandidate(line({ date: "2026-11-09" }), issued)).toBeNull(); // before the date on the cheque
    expect(scoreChequeCandidate(line({ date: "2027-06-01" }), issued)).toBeNull(); // long after it went stale
  });

  it("works the other way round for a cheque received from a customer", () => {
    const received: ChequeInput = { kind: "received", number: "778801", amount: 12000, chequeDate: "2026-11-01", depositedDate: "2026-11-03" };
    expect(scoreChequeCandidate({ date: "2026-11-05", amount: 12000, description: "CHQ DEP 778801", reference: "" }, received)?.tier).toBe("exact");
    expect(scoreChequeCandidate({ date: "2026-11-05", amount: -12000, description: "CHQ 778801", reference: "" }, received)).toBeNull();
    expect(scoreChequeCandidate({ date: "2026-11-02", amount: 12000, description: "CHQ DEP 778801", reference: "" }, received)).toBeNull(); // before it was deposited
  });
});
