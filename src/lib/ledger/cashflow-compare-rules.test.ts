import { describe, expect, it } from "vitest";
import { buildCashFlowComparison, rollUpToGroups, type CashFlowPeriod } from "./cashflow-compare-rules";

const period = (p: Partial<CashFlowPeriod>): CashFlowPeriod => ({ netProfit: 0, operating: [], investing: [], financing: [], netCashFromOperating: 0, netCashFromInvesting: 0, netCashFromFinancing: 0, openingCash: 0, closingCash: 0, actualCashMovement: 0, ...p });

describe("the cash flow comparison", () => {
  const cur = period({ netProfit: 500, operating: [{ accountId: "ar", name: "Accounts Receivable", amount: -200 }, { accountId: "dep", name: "Depreciation (non-cash)", amount: 50 }], investing: [{ accountId: "fa", name: "Fixed Assets", amount: -300 }], financing: [{ accountId: "loan", name: "Loans Payable", amount: 400 }], openingCash: 1000, closingCash: 1450 });
  const prev = period({ netProfit: 300, operating: [{ accountId: "ar", name: "Accounts Receivable", amount: 100 }], openingCash: 900, closingCash: 1000 });
  const cmp = buildCashFlowComparison(cur, prev);

  it("starts operating from the profit, matches lines across the periods, and adds up each activity", () => {
    expect(cmp.operating.headings[0].rows.map((r) => [r.sub, r.cur, r.prev])).toEqual([["Net profit", 500, 300], ["Accounts Receivable", -200, 100], ["Depreciation (non-cash)", 50, 0]]);
    expect(cmp.operating).toMatchObject({ cur: 350, prev: 400 });
    expect(cmp.investing).toMatchObject({ cur: -300, prev: 0 });
    expect(cmp.financing).toMatchObject({ cur: 400, prev: 0 });
    expect(cmp.netChange).toEqual({ cur: 450, prev: 400 });
  });

  it("compares the activities with the cash and bank actually held, for each period (zero when they tie, the gap when they do not)", () => {
    expect(cmp.difference).toEqual({ cur: 0, prev: -300 });
  });

  it("leaves out an activity that has nothing in either period", () => {
    expect(buildCashFlowComparison(period({}), period({})).investing.headings).toEqual([]);
  });
});

describe("rolling sub-accounts up into their group", () => {
  const groups: Record<string, { id: string; name: string }> = { himal: { id: "ar", name: "Accounts Receivable" }, modal: { id: "ar", name: "Accounts Receivable" } };
  const p = period({ operating: [{ accountId: "himal", name: "Himal Enterprises", amount: -100 }, { accountId: "modal", name: "Modal Test Co", amount: -50 }, { accountId: "dep", name: "Depreciation (non-cash)", amount: 30 }] });
  const rolled = rollUpToGroups(p, (id) => groups[id] ?? null);

  it("shows one line for the group, adding its sub-accounts up, and leaves other lines alone", () => {
    const rows = buildCashFlowComparison(rolled, period({})).operating.headings[0].rows;
    expect(rows.map((r) => [r.sub, r.cur])).toEqual([["Net profit", 0], ["Accounts Receivable", -150], ["Depreciation (non-cash)", 30]]);
  });
});
