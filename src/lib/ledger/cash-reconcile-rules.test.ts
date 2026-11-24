import { describe, expect, it } from "vitest";
import { adjustmentLines, explainState, explanationLines, openLines, reconcileMethodOf, settle, tickedTotals, type CashLine } from "./cash-reconcile-rules";

const line = (id: string, date: string, debit: number, credit: number, extra: Partial<CashLine> = {}): CashLine => ({
  id,
  entryId: `e-${id}`,
  date,
  debit,
  credit,
  sourceType: "sale",
  reference: null,
  memo: null,
  isReversed: false,
  reversalOfId: null,
  ...extra,
});

describe("what is left to reconcile", () => {
  it("leaves out lines already reconciled and lines after the date, and moves the opening balance into the opening", () => {
    const all = [line("o", "2026-01-01", 100, 0, { sourceType: "opening_balance" }), line("a", "2026-02-01", 200, 0), line("b", "2026-02-02", 0, 50), line("c", "2026-03-01", 500, 0)];
    const r = openLines(all, new Set(["a"]), "2026-02-28");
    expect(r.opening).toBe(100);
    expect(r.lines.map((l) => l.id)).toEqual(["b"]);
  });

  it("drops a void and its reversal when both are still open, but keeps a reversal of something reconciled earlier", () => {
    const sale = line("s", "2026-02-01", 300, 0, { isReversed: true });
    const undo = line("r", "2026-02-02", 0, 300, { reversalOfId: "e-s" });
    expect(openLines([sale, undo], new Set(), "2026-02-28").lines).toEqual([]);
    expect(openLines([sale, undo], new Set(["s"]), "2026-02-28").lines.map((l) => l.id)).toEqual(["r"]);
  });
});

describe("settling a reconciliation", () => {
  // Opening 100, five receipts of 200 (1,000 in) and two payments of 100 (200 out): the books say 900.
  const base = { opening: 100, cashIn: 1000, cashOut: 200 };

  it("closes at the books' figure when it is confirmed without a count", () => {
    expect(settle({ ...base, counted: null, adjust: false })).toEqual({ booksBefore: 900, difference: null, adjustment: 0, closing: 900, kind: "confirmed" });
  });

  it("shows a short against a count, and closes at the count once it is adjusted", () => {
    expect(settle({ ...base, counted: 850, adjust: false })).toMatchObject({ difference: -50, adjustment: 0, closing: 900, kind: "counted" });
    expect(settle({ ...base, counted: 850, adjust: true })).toMatchObject({ difference: -50, adjustment: -50, closing: 850 });
    expect(settle({ ...base, counted: 925, adjust: true })).toMatchObject({ difference: 25, adjustment: 25, closing: 925 });
  });

  it("refuses to adjust without a count, or when there is nothing to adjust", () => {
    expect(() => settle({ ...base, counted: null, adjust: true })).toThrow(/Count the cash/);
    expect(() => settle({ ...base, counted: 900, adjust: true })).toThrow(/nothing to adjust/);
  });

  it("adds up only the ticked lines", () => {
    const lines = [line("a", "2026-02-01", 200, 0), line("b", "2026-02-02", 0, 100), line("c", "2026-02-03", 300, 0)];
    expect(tickedTotals(lines, new Set(["a", "b"]))).toEqual({ cashIn: 200, cashOut: 100 });
  });
});

describe("explaining a short or excess later", () => {
  it("tracks how much of it is still unexplained", () => {
    expect(explainState(-50, 0)).toMatchObject({ remaining: 50, state: "open" });
    expect(explainState(-50, 30)).toMatchObject({ explained: 30, remaining: 20, state: "partly" });
    expect(explainState(-50, 50)).toMatchObject({ remaining: 0, state: "explained" });
    expect(explainState(0, 0).state).toBe("none");
  });

  it("posts the adjustment and its explanation to the same account, so the account nets back to nothing", () => {
    const net = (lines: { accountId: string; debitAmount?: number; creditAmount?: number }[], id: string) => lines.filter((l) => l.accountId === id).reduce((s, l) => s + (l.debitAmount ?? 0) - (l.creditAmount ?? 0), 0);
    const short = adjustmentLines("cash", "se", -50, "x");
    expect(net(short, "cash")).toBe(-50);
    expect(net(short, "se")).toBe(50);
    const found = explanationLines("se", "courier", -50, 50, "x");
    expect(net(found, "courier")).toBe(50);
    expect(net(found, "se")).toBe(-50);
    expect(net([...short, ...found], "se")).toBe(0);
    const excess = adjustmentLines("cash", "se", 25, "x");
    expect(net(excess, "cash")).toBe(25);
    expect(net([...excess, ...explanationLines("se", "income", 25, 25, "x")], "se")).toBe(0);
  });
});

describe("how an account is reconciled", () => {
  it("makes cash and wallet accounts tick whatever is stored, and bank accounts use the statement unless set to tick", () => {
    expect(reconcileMethodOf("1000", null)).toBe("ticking");
    expect(reconcileMethodOf("1000.01", "statement")).toBe("ticking");
    expect(reconcileMethodOf("1010.01", null)).toBe("statement");
    expect(reconcileMethodOf("1010.01", "statement")).toBe("statement");
    expect(reconcileMethodOf("1010.01", "ticking")).toBe("ticking");
  });
});
