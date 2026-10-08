import { describe, expect, it } from "vitest";
import { visibleLedgerLines, type LedgerLineLike } from "./ledger-lines";

const line = (entryId: string, debit: number, credit: number, running: number, over: Partial<LedgerLineLike> = {}): LedgerLineLike => ({ entryId, isReversed: false, reversalOfId: null, debit, credit, runningBalance: running, ...over });

describe("hiding reversed and voided entries", () => {
  // opening 0: +100 (later reversed), +50, -100 (the reversal), +20
  const lines = [line("A", 100, 0, 100, { isReversed: true }), line("B", 50, 0, 150), line("R", 0, 100, 50, { reversalOfId: "A" }), line("C", 20, 0, 70)];

  it("hides both halves of a pair, and works the running balance out again so it still adds up", () => {
    const r = visibleLedgerLines(lines, 0, false);
    expect(r.lines.map((l) => [l.entryId, l.runningBalance])).toEqual([["B", 50], ["C", 70]]); // B no longer shows the cancelled 100
    expect(r.hiddenPairs).toBe(1);
  });

  it("shows everything, with the report's own balances, when asked", () => {
    const r = visibleLedgerLines(lines, 0, true);
    expect(r.lines.map((l) => l.runningBalance)).toEqual([100, 150, 50, 70]);
    expect(r.hiddenPairs).toBe(0);
  });

  it("keeps a pair split by the edge of the period: the original is already in the opening balance", () => {
    // opening 100 (the original was before the period); the reversal falls inside
    const r = visibleLedgerLines([line("R", 0, 100, 0, { reversalOfId: "A" }), line("C", 20, 0, 20)], 100, false);
    expect(r.lines.map((l) => [l.entryId, l.runningBalance])).toEqual([["R", 0], ["C", 20]]);
    expect(r.hiddenPairs).toBe(0);
  });

  it("hides every line of an entry that touched the account more than once", () => {
    const multi = [line("A", 60, 0, 60, { isReversed: true }), line("A", 40, 0, 100, { isReversed: true }), line("R", 0, 60, 40, { reversalOfId: "A" }), line("R", 0, 40, 0, { reversalOfId: "A" })];
    const r = visibleLedgerLines(multi, 0, false);
    expect(r.lines).toHaveLength(0);
    expect(r.hiddenPairs).toBe(1);
  });

  it("leaves a ledger with nothing reversed untouched", () => {
    const plain = [line("X", 10, 0, 10), line("Y", 0, 4, 6)];
    expect(visibleLedgerLines(plain, 0, false).lines).toEqual(plain);
  });
});
