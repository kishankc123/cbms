import { describe, expect, it } from "vitest";
import { checkOpeningAsset, openingAssetAmounts, type OpeningAssetCheck } from "./opening-math";

const base: OpeningAssetCheck = {
  name: "Delivery van",
  originalPurchaseDate: "2024-01-15",
  openingDate: "2026-07-17",
  cost: 5000000,
  accumulated: 2000000,
  residual: 0,
  method: "straight_line",
  originalUsefulLifeMonths: 100,
  remainingUsefulLifeMonths: 40,
  depreciationStartDate: "2026-07-17",
};

describe("opening asset amounts", () => {
  it("the van from the spec: cost 5,000,000, depreciation 2,000,000 -> opening NBV 3,000,000", () => {
    expect(openingAssetAmounts({ cost: 5000000, accumulated: 2000000, residual: 0 })).toEqual({ netBookValue: 3000000, remainingDepreciable: 3000000, fullyDepreciated: false });
  });
  it("is fully depreciated once only the residual value is left", () => {
    expect(openingAssetAmounts({ cost: 100000, accumulated: 90000, residual: 10000 })).toMatchObject({ netBookValue: 10000, remainingDepreciable: 0, fullyDepreciated: true });
  });
});

describe("opening asset checks", () => {
  it("accepts a sound asset", () => {
    expect(checkOpeningAsset(base)).toBeNull();
  });

  it("refuses an asset bought on or after the opening date (that is a purchase)", () => {
    expect(checkOpeningAsset({ ...base, originalPurchaseDate: "2026-07-17" })).toMatch(/Purchase asset/);
    expect(checkOpeningAsset({ ...base, originalPurchaseDate: "2026-09-01" })).toMatch(/before your books start/);
  });

  it("refuses figures that don't add up", () => {
    expect(checkOpeningAsset({ ...base, cost: 0 })).toMatch(/original cost/);
    expect(checkOpeningAsset({ ...base, accumulated: 5000001 })).toMatch(/more than the original cost/);
    expect(checkOpeningAsset({ ...base, residual: 3000001 })).toMatch(/net book value/);
    expect(checkOpeningAsset({ ...base, name: " " })).toMatch(/asset name/);
  });

  it("needs a remaining life only while there is something left to depreciate", () => {
    expect(checkOpeningAsset({ ...base, remainingUsefulLifeMonths: null })).toMatch(/remaining useful life/);
    expect(checkOpeningAsset({ ...base, remainingUsefulLifeMonths: 200 })).toMatch(/longer than the original/);
    expect(checkOpeningAsset({ ...base, accumulated: 5000000, remainingUsefulLifeMonths: null, depreciationStartDate: null })).toBeNull();
    expect(checkOpeningAsset({ ...base, method: "none", remainingUsefulLifeMonths: null, depreciationStartDate: null })).toBeNull();
  });
});
