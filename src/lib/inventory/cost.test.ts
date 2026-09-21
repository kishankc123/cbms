import { describe, expect, it } from "vitest";
import { issueCost, replayCosts, unitCostOf, type ReplayEvent } from "./cost";

// Product A: opening 20 units at 250 (5,000); 10 Sep buy 10 at 300; 15 Sep sell 10.
const opening = (quantity: number): ReplayEvent => ({ id: "open", date: "2026-09-01", order: 1, type: "opening", quantity, value: quantity * 250 });
const buy = (date: string, quantity: number, rate: number, id = "buy"): ReplayEvent => ({ id, date, order: 2, type: "purchase", quantity, value: quantity * rate });
const sale = (quantity: number): ReplayEvent => ({ id: "sale", date: "2026-09-15", order: 3, type: "sale", quantity: -quantity, value: 0 });

describe("cost of stock", () => {
  it("costs an issue at the average, clearing the whole value with the last unit", () => {
    expect(issueCost({ quantity: 30, value: 8000 }, 10, 999)).toBe(2666.67);
    expect(issueCost({ quantity: 4, value: 1000 }, 4, 999)).toBe(1000);
    // beyond what is on hand costs at the same average; with nothing on hand, at the standard price
    expect(issueCost({ quantity: 10, value: 1000 }, 15, 999)).toBe(1500);
    expect(issueCost({ quantity: 0, value: 0 }, 5, 40)).toBe(200);
    expect(unitCostOf({ quantity: 0, value: 0 }, 40)).toBe(40);
  });
});

describe("replaying history in date order", () => {
  it("costs the sale at the average of what was on hand on its date", () => {
    const r = replayCosts([opening(20), buy("2026-09-10", 10, 300), sale(10)], 0);
    expect(r.values.get("sale")).toBe(-2666.67);
    expect(r.finalQuantity).toBe(20);
    expect(r.finalValue).toBe(5333.33);
  });

  it("an edit to the opening quantity re-costs the later sale", () => {
    const r = replayCosts([opening(25), buy("2026-09-10", 10, 300), sale(10)], 0);
    expect(r.values.get("sale")).toBe(-2642.86); // 9,250 / 35 per unit
  });

  it("a purchase entered late but dated earlier lowers the average the sale was costed at", () => {
    const r = replayCosts([opening(20), buy("2026-09-10", 10, 300), buy("2026-09-12", 10, 200, "late"), sale(10)], 0);
    expect(r.values.get("sale")).toBe(-2500); // 10,000 / 40 per unit on 15 Sep
  });

  it("reports where stock would drop below zero", () => {
    const r = replayCosts([opening(10), sale(18)], 0);
    expect(r.lowestQuantity).toBe(-8);
    expect(r.lowestDate).toBe("2026-09-15");
  });

  it("the opening balance comes first on its own day, whatever order things were entered in", () => {
    const a: ReplayEvent = { id: "a", date: "2026-09-01", order: 1, type: "purchase", quantity: 5, value: 500 };
    const o: ReplayEvent = { id: "o", date: "2026-09-01", order: 2, type: "opening", quantity: 5, value: 250 };
    const s: ReplayEvent = { id: "s", date: "2026-09-01", order: 3, type: "sale", quantity: -5, value: 0 };
    const r = replayCosts([a, o, s], 0);
    expect(r.values.get("s")).toBe(-375); // (250 + 500) / 10 per unit
  });
});
