import { describe, expect, it } from "vitest";
import { decideDetails } from "./pending-details";

const recorded = { subtotal: 100000, tax: 13000, total: 113000 };

describe("adding items to a purchase recorded by amount", () => {
  it("posts as entered when the items add up exactly", () => {
    expect(decideDetails({ recorded, items: recorded, filed: true }).mode).toBe("as_entered");
  });

  it("treats a small difference as rounding, filed or not: the bill's figures stand", () => {
    const items = { subtotal: 100000.4, tax: 13000.05, total: 113000.45 };
    expect(decideDetails({ recorded, items, filed: true }).mode).toBe("fixed");
    expect(decideDetails({ recorded, items, filed: false }).mode).toBe("fixed");
  });

  it("asks for a confirmation when it is further off and not filed, and refuses once filed", () => {
    const items = { subtotal: 100500, tax: 13065, total: 113565 };
    expect(decideDetails({ recorded, items, filed: false }).mode).toBe("confirm");
    const filed = decideDetails({ recorded, items, filed: true });
    expect(filed.mode).toBe("refused");
    expect("message" in filed && filed.message).toMatch(/500.00 more than the bill's value of 100000.00/);
  });

  it("looks at the VAT as well as the value", () => {
    const items = { subtotal: 100000, tax: 12000, total: 112000 };
    const r = decideDetails({ recorded, items, filed: true });
    expect(r.mode).toBe("refused");
    expect("message" in r && r.message).toMatch(/1000.00 less VAT/);
  });
});
