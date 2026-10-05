import { describe, expect, it } from "vitest";
import { depreciableAmount, depreciationSchedule, firstPeriodDepreciation } from "./depreciation";

const sum = (rows: { depreciation: number }[]) => Math.round(rows.reduce((s, r) => s + r.depreciation, 0) * 100) / 100;

describe("depreciableAmount", () => {
  it("is cost less residual less what was already taken, never negative", () => {
    expect(depreciableAmount(120000, 0)).toBe(120000);
    expect(depreciableAmount(120000, 20000, 30000)).toBe(70000);
    expect(depreciableAmount(100, 80, 50)).toBe(0);
  });
});

describe("straight-line schedule", () => {
  it("laptop: 120,000 over 5 years is 2,000 a month and ends at zero", () => {
    const rows = depreciationSchedule({ cost: 120000, residual: 0, method: "straight_line", months: 60, startDate: "2026-07-20", calendar: "AD" });
    expect(rows).toHaveLength(60);
    expect(rows[0]).toMatchObject({ number: 1, opening: 120000, depreciation: 2000, closing: 118000 });
    expect(rows[1]).toMatchObject({ opening: 118000, depreciation: 2000, closing: 116000 });
    expect(rows[59].closing).toBe(0);
    expect(sum(rows)).toBe(120000);
  });

  it("the last period absorbs rounding so the total is exact", () => {
    const rows = depreciationSchedule({ cost: 100000, residual: 0, method: "straight_line", months: 3, startDate: "2026-07-20", calendar: "AD" });
    expect(rows.map((r) => r.depreciation)).toEqual([33333.33, 33333.33, 33333.34]);
    expect(rows[2].closing).toBe(0);
  });

  it("never depreciates below the residual value", () => {
    const rows = depreciationSchedule({ cost: 120000, residual: 20000, method: "straight_line", months: 50, startDate: "2026-07-20", calendar: "AD" });
    expect(sum(rows)).toBe(100000);
    expect(rows[rows.length - 1].closing).toBe(20000);
  });

  it("continues from an opening position: only the remaining amount over the remaining months", () => {
    const rows = depreciationSchedule({ cost: 5000000, residual: 0, accumulatedBefore: 2000000, method: "straight_line", months: 40, startDate: "2026-07-17", calendar: "BS" });
    expect(rows[0]).toMatchObject({ opening: 3000000, depreciation: 75000, closing: 2925000 });
    expect(sum(rows)).toBe(3000000);
  });
});

describe("declining balance schedule", () => {
  it("depreciates faster early, ends exactly at the residual value and never below it", () => {
    const rows = depreciationSchedule({ cost: 100000, residual: 10000, method: "declining_balance", months: 36, startDate: "2026-07-20", calendar: "AD" });
    expect(rows[0].depreciation).toBeGreaterThan(rows[10].depreciation);
    expect(sum(rows)).toBe(90000);
    expect(rows[rows.length - 1].closing).toBe(10000);
    expect(rows.every((r) => r.closing >= 10000)).toBe(true);
  });
});

describe("nothing to depreciate", () => {
  it("returns no periods for no depreciation, no life, or a fully depreciated asset", () => {
    expect(depreciationSchedule({ cost: 1000, residual: 0, method: "none", months: 12, startDate: "2026-07-20", calendar: "AD" })).toEqual([]);
    expect(depreciationSchedule({ cost: 1000, residual: 0, method: "straight_line", months: null, startDate: "2026-07-20", calendar: "AD" })).toEqual([]);
    expect(depreciationSchedule({ cost: 1000, residual: 0, accumulatedBefore: 1000, method: "straight_line", months: 12, startDate: "2026-07-20", calendar: "AD" })).toEqual([]);
    expect(firstPeriodDepreciation({ cost: 1000, residual: 0, method: "none", months: 12, startDate: "2026-07-20", calendar: "AD" })).toBe(0);
  });
});

describe("calendar months", () => {
  it("follows Nepali months for a BS organization and Gregorian months for an AD one", () => {
    const bs = depreciationSchedule({ cost: 120000, residual: 0, method: "straight_line", months: 12, startDate: "2026-07-20", calendar: "BS" });
    expect(bs[0].label).toBe("Shrawan 2083");
    expect(bs[1].label).toBe("Bhadra 2083");
    expect(bs[0].periodEnd < bs[1].periodStart).toBe(true);

    const ad = depreciationSchedule({ cost: 120000, residual: 0, method: "straight_line", months: 12, startDate: "2026-07-20", calendar: "AD" });
    expect(ad[0].label).toBe("July 2026");
    expect(ad[0].periodEnd).toBe("2026-07-31");
  });
});
