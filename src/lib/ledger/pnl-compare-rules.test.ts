import { describe, expect, it } from "vitest";
import { buildSeries } from "./pnl-series-rules";
import { convertBStoAD } from "@/lib/calendar";
import { buildBalanceComparison, buildComparison, change, changePercent, comparisonOf, margin, money, periodLabel, periodOf, periodOptions, type AccountInfo } from "./pnl-compare-rules";

const bs = (year: number, month: number, day = 1) => convertBStoAD({ year, month, day })!;

describe("periods", () => {
  it("a month, a fiscal quarter and a fiscal year follow the Nepali calendar", () => {
    const month = periodOf("month", "BS", bs(2083, 5, 10));
    expect(month).toEqual({ from: bs(2083, 5, 1), to: expect.any(String) });
    expect(periodLabel("month", "BS", month)).toBe("Bhadra 2083");

    const q = periodOf("quarter", "BS", bs(2083, 5, 10));
    expect(q.from).toBe(bs(2083, 4, 1));
    expect(periodLabel("quarter", "BS", q)).toBe("Shrawan – Ashwin 2083");
    expect(periodOf("quarter", "BS", bs(2083, 10, 1)).from).toBe(bs(2083, 10, 1));

    const year = periodOf("year", "BS", bs(2084, 2, 1));
    expect(year.from).toBe(bs(2083, 4, 1));
    expect(periodLabel("year", "BS", year)).toBe("FY 2083/84");
  });

  it("a week runs Sunday to Saturday", () => {
    const w = periodOf("week", "AD", "2026-11-18");
    expect(w).toEqual({ from: "2026-11-15", to: "2026-11-21" });
  });

  it("compares with the previous period or the same one a year earlier", () => {
    const bhadra = periodOf("month", "BS", bs(2083, 5, 10));
    expect(comparisonOf("month", "BS", bhadra, "previous").from).toBe(bs(2083, 4, 1));
    expect(comparisonOf("month", "BS", bhadra, "last_year").from).toBe(bs(2082, 5, 1));
    const q = periodOf("quarter", "BS", bs(2083, 5, 10));
    expect(comparisonOf("quarter", "BS", q, "previous").from).toBe(bs(2083, 1, 1));
    expect(comparisonOf("quarter", "BS", q, "last_year").from).toBe(bs(2082, 4, 1));
    expect(comparisonOf("day", "AD", { from: "2026-11-18", to: "2026-11-18" }, "last_year").from).toBe("2025-11-18");
  });

  it("lists the periods newest first and keeps one that is older than the list", () => {
    const list = periodOptions("month", "AD", "2026-11-18", "2020-01-01");
    expect(list[0].value).toBe("2026-11-01");
    expect(list.at(-1)!.value).toBe("2020-01-01");
  });
});

describe("the comparison table", () => {
  const info = (id: string, code: string, name: string, parentId: string | null = null, subCategory: string | null = null): AccountInfo => ({ id, code, name, subCategory, parentId });
  const infos = new Map([
    info("sales", "4000", "Sales Revenue"),
    info("room", "4000.01", "Room sales", "sales"),
    info("rest", "4000.02", "Restaurant", "sales"),
    info("cogs", "5000", "Cost of Goods Sold", null, "Cost of goods sold"),
    info("kitchen", "5000.01", "Kitchen items", "cogs"),
    info("rent", "5100", "Rent"),
    info("util", "5300", "Utilities"),
    info("light", "5300.01", "Light bills", "util"),
  ].map((a) => [a.id, a] as const));

  const cmp = buildComparison(
    infos,
    { income: [{ accountId: "room", amount: 700 }, { accountId: "rest", amount: 300 }], expenses: [{ accountId: "kitchen", amount: 200 }, { accountId: "rent", amount: 100 }, { accountId: "light", amount: 50 }] },
    { income: [{ accountId: "room", amount: 600 }], expenses: [{ accountId: "kitchen", amount: 250 }, { accountId: "rent", amount: 100 }] },
  );

  it("shows costs as negatives, so a positive change is always better", () => {
    expect(cmp.income).toMatchObject({ cur: 1000, prev: 600 });
    expect(cmp.cost).toMatchObject({ cur: -200, prev: -250 });
    expect(change(cmp.cost)).toBe(50);
    expect(cmp.grossProfit).toEqual({ cur: 800, prev: 350 });
    expect(cmp.expenses).toMatchObject({ cur: -150, prev: -100 });
    expect(cmp.netProfit).toEqual({ cur: 650, prev: 250 });
  });

  it("groups accounts under their group, in code order, with a row for an account that has no amount in one period", () => {
    expect(cmp.income.headings.map((h) => [h.name, h.rows.map((r) => r.sub)])).toEqual([["Sales Revenue", ["Room sales", "Restaurant"]]]);
    expect(cmp.expenses.headings.map((h) => h.name)).toEqual(["Rent", "Utilities"]);
    expect(cmp.expenses.headings[0].rows[0].sub).toBe("");
    expect(cmp.expenses.headings[1].rows[0]).toMatchObject({ sub: "Light bills", cur: -50, prev: 0 });
  });

  it("changes, margins and text", () => {
    expect(changePercent({ cur: 1000, prev: 600 })).toBe(66.67);
    expect(changePercent({ cur: -50, prev: 0 })).toBe("new");
    expect(changePercent({ cur: 0, prev: 0 })).toBeNull();
    expect(changePercent({ cur: 40, prev: 40 })).toBeNull();
    expect(margin(cmp.grossProfit, cmp.income)).toEqual({ cur: 80, prev: 58 });
    expect(margin({ cur: 5, prev: 5 }, { cur: 0, prev: 0 })).toEqual({ cur: null, prev: null });
    expect([money(0), money(1234.5), money(-1234.5)]).toEqual(["-", "1,234.50", "(1,234.50)"]);
  });
});

describe("salaries on the Profit & Loss", () => {
  const info = (id: string, code: string, name: string, parentId: string | null = null): AccountInfo => ({ id, code, name, subCategory: "Indirect expenses", parentId });
  const infos = new Map([
    info("sal", "5200", "Salaries"),
    info("basic", "5200.01", "Basic salary", "sal"),
    info("inc", "5200.02", "Performance incentives", "sal"),
    info("ot", "5200.02.01", "Overtime bonus", "inc"),
    info("dash", "5200.02.02", "Dashain bonus", "inc"),
    info("allow", "5200.03", "Allowances", "sal"),
    info("rent", "5100", "Rent"),
  ].map((a) => [a.id, a] as const));
  const none = { income: [], expenses: [] };
  const cur = { income: [], expenses: [{ accountId: "basic", amount: 500 }, { accountId: "ot", amount: 35 }, { accountId: "dash", amount: 13 }, { accountId: "allow", amount: 20 }, { accountId: "rent", amount: 100 }] };

  it("is one Salaries heading: Basic salary and Allowances as lines, the incentive headings under a Performance incentives sub-heading", () => {
    const cmp = buildComparison(infos, cur, none);
    expect(cmp.expenses.headings.map((h) => h.name)).toEqual(["Rent", "Salaries"]);
    const rows = cmp.expenses.headings[1].rows;
    expect(rows.map((r) => [r.sub, r.subGroup?.name ?? null])).toEqual([["Basic salary", null], ["Overtime bonus", "Performance incentives"], ["Dashain bonus", "Performance incentives"], ["Allowances", null]]);
    expect(cmp.expenses.cur).toBe(-668);
  });

  it("does the same across several periods", () => {
    const s = buildSeries(infos, [cur, none]);
    const rows = s.expenses.headings[1].rows;
    expect(rows.map((r) => r.subGroup?.name ?? null)).toEqual([null, "Performance incentives", "Performance incentives", null]);
    expect(rows[1].values).toEqual([-35, 0]);
  });
});

describe("the balance sheet comparison", () => {
  const a = (id: string, code: string, name: string, parentId: string | null = null): AccountInfo => ({ id, code, name, subCategory: null, parentId });
  const infos = new Map([a("cash", "1000", "Cash"), a("bank", "1010", "Bank"), a("nabil", "1010.01", "Nabil", "bank"), a("loan", "2200", "Loans Payable"), a("cap", "3000", "Capital")].map((x) => [x.id, x] as const));
  const cmp = buildBalanceComparison(
    infos,
    { assets: [{ accountId: "cash", amount: 500 }, { accountId: "nabil", amount: 700 }], liabilities: [{ accountId: "loan", amount: 400 }], equity: [{ accountId: "cap", amount: 600 }], retainedEarnings: 200 },
    { assets: [{ accountId: "cash", amount: 300 }], liabilities: [{ accountId: "loan", amount: 400 }], equity: [{ accountId: "cap", amount: 600 }], retainedEarnings: -700 },
  );

  it("totals each side and checks that assets equal liabilities plus equity, for both dates", () => {
    expect(cmp.assets).toMatchObject({ cur: 1200, prev: 300 });
    expect(cmp.equity).toMatchObject({ cur: 800, prev: -100 });
    expect(cmp.liabilitiesAndEquity).toEqual({ cur: 1200, prev: 300 });
    expect(cmp.difference).toEqual({ cur: 0, prev: 0 });
  });

  it("puts accounts under their group and shows the profit not yet closed to equity as its own line", () => {
    expect(cmp.assets.headings.map((h) => [h.name, h.rows.map((r) => r.sub)])).toEqual([["Cash", [""]], ["Bank", ["Nabil"]]]);
    expect(cmp.equity.headings.at(-1)).toMatchObject({ name: "Retained earnings (current)", rows: [{ accountId: "", cur: 200, prev: -700 }] });
  });
});
