import { describe, expect, it } from "vitest";
import { assetPurchaseAmounts } from "./amounts";

describe("asset purchase amounts", () => {
  it("keeps recoverable VAT out of the cost: 1,000,000 + 130,000 VAT -> cost 1,000,000, invoice 1,130,000", () => {
    expect(assetPurchaseAmounts({ purchasePrice: 1000000, freightCost: 0, installationCost: 0, otherCost: 0 }, 13, true)).toEqual({ base: 1000000, vat: 130000, capitalizedCost: 1000000, total: 1130000 });
  });

  it("adds VAT that can't be claimed back to the cost", () => {
    expect(assetPurchaseAmounts({ purchasePrice: 1000000, freightCost: 0, installationCost: 0, otherCost: 0 }, 13, false)).toEqual({ base: 1000000, vat: 130000, capitalizedCost: 1130000, total: 1130000 });
  });

  it("includes freight, installation and other attributable costs in the cost and the VAT base", () => {
    const a = assetPurchaseAmounts({ purchasePrice: 100000, freightCost: 5000, installationCost: 3000, otherCost: 2000 }, 13, true);
    expect(a.base).toBe(110000);
    expect(a.vat).toBe(14300);
    expect(a.capitalizedCost).toBe(110000);
    expect(a.total).toBe(124300);
  });

  it("charges no VAT at a zero rate (non-VAT bill types)", () => {
    expect(assetPurchaseAmounts({ purchasePrice: 50000, freightCost: 0, installationCost: 0, otherCost: 0 }, 0, true)).toEqual({ base: 50000, vat: 0, capitalizedCost: 50000, total: 50000 });
  });
});
