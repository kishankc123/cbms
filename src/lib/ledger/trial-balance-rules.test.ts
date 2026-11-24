import { describe, expect, it } from "vitest";
import type { AccountInfo } from "./pnl-compare-rules";
import { balanced, buildTrialBalance, headingTotals, net } from "./trial-balance-rules";

const a = (id: string, code: string, name: string, category: string, parentId: string | null = null): AccountInfo => ({ id, code, name, category, subCategory: null, parentId });
const infos = new Map([a("cash", "1000", "Cash", "asset"), a("cap", "3000", "Capital", "equity"), a("sales", "4000", "Sales", "income"), a("rent", "5100", "Rent", "expense"), a("idle", "5900", "Unused", "expense")].map((x) => [x.id, x] as const));

describe("the trial balance by period", () => {
  // Before the period: capital 1,000 put in as cash. In the period: sales 600 in cash, rent 150 paid.
  const opening = [{ accountId: "cash", debit: 1000, credit: 0 }, { accountId: "cap", debit: 0, credit: 1000 }];
  const closing = [{ accountId: "cash", debit: 1600, credit: 150 }, { accountId: "cap", debit: 0, credit: 1000 }, { accountId: "sales", debit: 0, credit: 600 }, { accountId: "rent", debit: 150, credit: 0 }, { accountId: "idle", debit: 0, credit: 0 }];
  const tb = buildTrialBalance(infos, opening, closing);

  it("shows each account's opening, gross movement and closing, and drops accounts with nothing", () => {
    const cash = tb.sections[2].headings[0].rows[0];
    expect(cash).toMatchObject({ opening: { dr: 1000, cr: 0 }, movement: { dr: 600, cr: 150 }, closing: { dr: 1450, cr: 0 } });
    expect(tb.sections.map((s) => s.title)).toEqual(["Income", "Expenses", "Assets", "Equity"]);
    expect(tb.sections[1].headings.map((h) => h.name)).toEqual(["Rent"]);
  });

  it("balances at the start, in the movement and at the end", () => {
    expect(tb.totals.opening).toEqual({ dr: 1000, cr: 1000 });
    expect(tb.totals.movement).toEqual({ dr: 750, cr: 750 });
    expect(tb.totals.closing).toEqual({ dr: 1600, cr: 1600 });
    expect([tb.totals.opening, tb.totals.movement, tb.totals.closing].every(balanced)).toBe(true);
  });

  it("totals a heading: balances netted, movement added", () => {
    const rows = [
      { accountId: "x", sub: "A", opening: { dr: 100, cr: 0 }, movement: { dr: 50, cr: 10 }, closing: { dr: 140, cr: 0 } },
      { accountId: "y", sub: "B", opening: { dr: 0, cr: 30 }, movement: { dr: 0, cr: 20 }, closing: { dr: 0, cr: 50 } },
    ];
    expect(headingTotals(rows)).toEqual({ opening: { dr: 70, cr: 0 }, movement: { dr: 50, cr: 30 }, closing: { dr: 90, cr: 0 } });
  });

  it("puts a balance on one side only", () => {
    expect(net(500, 200)).toEqual({ dr: 300, cr: 0 });
    expect(net(200, 500)).toEqual({ dr: 0, cr: 300 });
  });
});
