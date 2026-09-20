import { describe, it, expect } from "vitest";
import { ownershipPct, proportionalPaid, summarizeOwnership, withinAuthorised } from "./rules";

const cap = { authorisedCapital: 10_000_000, issuedShares: 25_000, faceValue: 100 };

describe("ownership arithmetic", () => {
  const holders = [
    { id: "a", name: "Asha", shares: 15_000, paid: 1_000_000, active: true },
    { id: "b", name: "Binod", shares: 6_250, paid: 0, active: true },
    { id: "c", name: "Old holder", shares: 999, paid: 0, active: false },
  ];

  it("derives issued capital, percentages and unpaid amounts", () => {
    const s = summarizeOwnership(cap, holders);
    expect(s.issuedCapital).toBe(2_500_000);
    expect(s.allocatedShares).toBe(21_250);
    expect(s.unallocatedShares).toBe(3_750);
    expect(s.allocationPct).toBe(85);
    expect(s.holders[0]).toMatchObject({ ownershipPct: 60, subscribed: 1_500_000, unpaid: 500_000 });
    expect(s.exceedsAuthorised).toBe(false);
  });

  it("reports 100% when every issued share is allocated, and ignores inactive holders", () => {
    const full = summarizeOwnership(cap, [{ id: "a", name: "A", shares: 25_000, paid: 0, active: true }, ...holders.slice(2)]);
    expect(full.allocationPct).toBe(100);
    expect(full.unallocatedShares).toBe(0);
  });

  it("never divides by zero before capital is set up", () => {
    expect(ownershipPct(10, 0)).toBe(0);
    expect(summarizeOwnership({ authorisedCapital: 0, issuedShares: 0, faceValue: 0 }, []).allocationPct).toBe(0);
  });

  it("checks new shares against the authorised capital", () => {
    expect(withinAuthorised(cap, 75_000)).toBe(true); // 100,000 shares x 100 = 10,000,000
    expect(withinAuthorised(cap, 75_001)).toBe(false);
    expect(withinAuthorised({ ...cap, authorisedCapital: 0 }, 1_000_000)).toBe(true); // no ceiling set
  });

  it("moves paid capital in proportion to the shares transferred", () => {
    expect(proportionalPaid({ shares: 6_000, paid: 300_000 }, 1_000)).toBe(50_000);
    expect(proportionalPaid({ shares: 6_000, paid: 300_000 }, 6_000)).toBe(300_000);
    expect(proportionalPaid({ shares: 0, paid: 0 }, 10)).toBe(0);
  });
});
