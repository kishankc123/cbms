import { describe, expect, it } from "vitest";
import { applyRounding, computeMonthlyTds, type TdsInput } from "./salary-tax-calc";

const slabs = [{ upTo: 500000, rate: 1 }, { upTo: 700000, rate: 10 }, { upTo: null, rate: 20 }];
const base: TdsInput = { taxablePay: 65000, earnedBefore: 0, withheldBefore: 0, priorIncome: 0, priorTds: 0, monthsLeft: 12, slabs, rounding: "none" };

describe("monthly salary TDS", () => {
  it("projects the year, taxes it slab by slab and spreads it over the months left", () => {
    const r = computeMonthlyTds(base); // 65,000 x 12 = 780,000: 5,000 + 20,000 + 16,000 = 41,000
    expect(r).toMatchObject({ projected: 780000, annualTax: 41000, stillToWithhold: 41000, tds: 3416.67, missing: null });
    expect(r.breakdown.map((b) => [b.amount, b.tax])).toEqual([[500000, 5000], [200000, 2000 * 10], [80000, 16000]]);
  });

  it("takes off what was already withheld and counts only the months still to come", () => {
    // two months already paid at 65,000 with 6,833.34 withheld; this is month 3 of 12, 10 months left including this one
    const r = computeMonthlyTds({ ...base, earnedBefore: 130000, withheldBefore: 6833.34, monthsLeft: 10 });
    expect(r.projected).toBe(130000 + 650000);
    expect(r.stillToWithhold).toBe(34166.66);
    expect(r.tds).toBe(3416.67);
  });

  it("a raise in a later month raises the remaining months and nothing earlier", () => {
    const before = computeMonthlyTds({ ...base, earnedBefore: 130000, withheldBefore: 6833.34, monthsLeft: 10 });
    const raised = computeMonthlyTds({ ...base, taxablePay: 80000, earnedBefore: 130000, withheldBefore: 6833.34, monthsLeft: 10 });
    expect(raised.tds).toBeGreaterThan(before.tds);
  });

  it("the last month clears whatever is left, and never goes below zero", () => {
    expect(computeMonthlyTds({ ...base, earnedBefore: 715000, withheldBefore: 37583.33, monthsLeft: 1 }).tds).toBe(3416.67);
    expect(computeMonthlyTds({ ...base, withheldBefore: 99999, monthsLeft: 1 }).tds).toBe(0);
  });

  it("counts income and tax from an earlier employer in the same year", () => {
    const r = computeMonthlyTds({ ...base, monthsLeft: 6, priorIncome: 300000, priorTds: 3000 });
    expect(r.projected).toBe(300000 + 65000 * 6);
    expect(r.stillToWithhold).toBe(r.annualTax - 3000);
  });

  it("takes no TDS, and says why, when no slabs are published", () => {
    expect(computeMonthlyTds({ ...base, slabs: null })).toMatchObject({ tds: 0, missing: "slabs", annualTax: 0 });
  });

  it("follows the payroll rounding rule", () => {
    expect(applyRounding("none", 3416.666)).toBe(3416.67);
    expect(applyRounding("nearest", 3416.5)).toBe(3417);
    expect(applyRounding("up", 3416.01)).toBe(3417);
    expect(applyRounding("up", 3416)).toBe(3416);
    expect(applyRounding("down", 3416.99)).toBe(3416);
    expect(computeMonthlyTds({ ...base, rounding: "nearest" }).tds).toBe(3417);
  });
});
