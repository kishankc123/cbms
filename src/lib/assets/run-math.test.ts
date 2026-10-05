import { describe, expect, it } from "vitest";
import { addMonths, monthRange } from "@/lib/calendar";
import { assetRunAmount, isFullyDepreciated, type RunAsset } from "./run-math";

const base: RunAsset = { cost: 120000, residual: 0, openingAccumulated: 0, accumulated: 0, method: "straight_line", months: 12, startDate: "2026-01-10", lastDepreciationDate: null };
const end = (months: number) => monthRange("AD", addMonths("AD", "2026-01-10", months)).to;

describe("a monthly run for one asset", () => {
  it("depreciates the month it is run for", () => {
    expect(assetRunAmount(base, end(0), "AD")).toEqual({ amount: 10000, months: 1, accumulatedAfter: 10000 });
  });
  it("catches up on every month that ended since the last posted one", () => {
    expect(assetRunAmount({ ...base, accumulated: 10000, lastDepreciationDate: end(0) }, end(3), "AD")).toEqual({ amount: 30000, months: 3, accumulatedAfter: 40000 });
  });
  it("does nothing before the start month, after the last month, or for a method of none", () => {
    expect(assetRunAmount(base, "2025-12-31", "AD")).toBeNull();
    expect(assetRunAmount({ ...base, accumulated: 120000, lastDepreciationDate: end(11) }, end(14), "AD")).toBeNull();
    expect(assetRunAmount({ ...base, method: "none" }, end(5), "AD")).toBeNull();
  });
  it("an opening asset carries on from what was already depreciated", () => {
    const opening: RunAsset = { ...base, cost: 100000, openingAccumulated: 40000, accumulated: 40000, months: 30 };
    expect(assetRunAmount(opening, end(0), "AD")).toEqual({ amount: 2000, months: 1, accumulatedAfter: 42000 });
  });
  it("knows when only the residual value is left", () => {
    expect(isFullyDepreciated(100000, 10000, 90000)).toBe(true);
    expect(isFullyDepreciated(100000, 10000, 89999.99)).toBe(false);
  });
});
