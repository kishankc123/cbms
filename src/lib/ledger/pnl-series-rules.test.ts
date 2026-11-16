import { describe, expect, it } from "vitest";
import { convertBStoAD } from "@/lib/calendar";
import { periodOf, quarterMonthLabel, quarterMonths, quarterTitle, type AccountInfo } from "./pnl-compare-rules";
import { buildSeries, withTotalOf } from "./pnl-series-rules";

const a = (id: string, code: string, name: string, parentId: string | null = null, subCategory: string | null = null): AccountInfo => ({ id, code, name, subCategory, parentId });
const infos = new Map([a("sales", "4000", "Sales"), a("cogs", "5000", "Cost of Goods Sold", null, "Cost of goods sold"), a("rent", "5100", "Rent"), a("light", "5300.01", "Light bills", "util"), a("util", "5300", "Utilities")].map((x) => [x.id, x] as const));
const month = (income: number, cost: number, rent: number, light = 0) => ({ income: [{ accountId: "sales", amount: income }], expenses: [{ accountId: "cogs", amount: cost }, { accountId: "rent", amount: rent }, ...(light ? [{ accountId: "light", amount: light }] : [])] });

describe("profit and loss across several periods", () => {
  // three months of a quarter, then the same quarter a year earlier
  const s = withTotalOf(buildSeries(infos, [month(100, 40, 10), month(200, 60, 10, 5), month(300, 80, 10), month(500, 150, 30)]), 3);

  it("gives each line a value for every period, with the quarter added as the sum of the three months", () => {
    expect(s.income.headings[0].rows[0].values).toEqual([100, 200, 300, 600, 500]);
    expect(s.cost.totals).toEqual([-40, -60, -80, -180, -150]);
    expect(s.expenses.headings.map((h) => h.name)).toEqual(["Rent", "Utilities"]);
    expect(s.expenses.headings[1].rows[0]).toMatchObject({ sub: "Light bills", values: [0, -5, 0, -5, 0] });
  });

  it("works out gross and net profit for every column, costs and expenses being negative", () => {
    expect(s.grossProfit).toEqual([60, 140, 220, 420, 350]);
    expect(s.netProfit).toEqual([50, 125, 210, 385, 320]);
  });
});

describe("a fiscal quarter", () => {
  const bs = (year: number, month: number) => convertBStoAD({ year, month, day: 1 })!;
  const q = periodOf("quarter", "BS", bs(2083, 5));
  it("is named by its place in the fiscal year and split into its three months", () => {
    expect(quarterTitle(q)).toBe("Q1 · FY 2083/84");
    expect(quarterMonths(q).map(quarterMonthLabel)).toEqual(["Shrawan 2083", "Bhadra 2083", "Ashwin 2083"]);
    expect(quarterTitle(periodOf("quarter", "BS", bs(2083, 11)))).toBe("Q3 · FY 2083/84");
    expect(quarterMonths(q)[2].to).toBe(q.to);
  });
});
