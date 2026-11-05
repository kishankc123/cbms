import { describe, expect, it } from "vitest";
import { appliesInPeriod, componentPay, type Assignment, type CatalogComponent } from "./components";

const comp = (over: Partial<CatalogComponent> & { id: string }): CatalogComponent => ({ name: over.id, type: "allowance", amount: 0, taxable: true, calcType: "fixed", countsForRetirement: false, recurrence: "recurring", ...over });
const give = (componentId: string, over: Partial<Assignment> = {}): Assignment => ({ componentId, amount: null, effectiveFrom: "2026-01-01", effectiveTo: null, ...over });
const period = { periodStart: "2026-08-01", periodEnd: "2026-08-31", proratedBasic: 30000 };

describe("component pay", () => {
  it("matches the old company-wide totals when everyone is given every component", () => {
    const catalog = [comp({ id: "a", amount: 2000 }), comp({ id: "b", amount: 500, taxable: false }), comp({ id: "d", type: "deduction", amount: 300 })];
    const r = componentPay(catalog, catalog.map((c) => give(c.id)), period);
    // the old formula: sums of the catalog amounts
    expect(r).toMatchObject({ allowances: 2500, deductions: 300, taxableAllowances: 2000 });
  });

  it("gives each employee only what they are assigned, with their own amount if set", () => {
    const catalog = [comp({ id: "a", amount: 2000 }), comp({ id: "b", amount: 500 })];
    expect(componentPay(catalog, [give("a", { amount: 3500 })], period).allowances).toBe(3500);
    expect(componentPay(catalog, [], period).allowances).toBe(0);
  });

  it("works a percentage on the basic salary paid, and counts flagged allowances for retirement", () => {
    const catalog = [comp({ id: "hra", calcType: "percent", amount: 40, countsForRetirement: true }), comp({ id: "t", amount: 1000 })];
    const r = componentPay(catalog, [give("hra"), give("t")], period);
    expect(r).toMatchObject({ allowances: 13000, retirementAllowances: 12000 });
    expect(r.lines[0]).toMatchObject({ name: "hra", amount: 12000, calcType: "percent" });
  });

  it("honours the dates of an assignment and counts a one-time component only in its own period", () => {
    const rec = comp({ id: "r", amount: 100 });
    const once = comp({ id: "o", amount: 4000, recurrence: "one_time" });
    expect(appliesInPeriod(rec, give("r", { effectiveFrom: "2026-09-01" }), period.periodStart, period.periodEnd)).toBe(false);
    expect(appliesInPeriod(rec, give("r", { effectiveTo: "2026-07-31" }), period.periodStart, period.periodEnd)).toBe(false);
    expect(appliesInPeriod(rec, give("r", { effectiveTo: "2026-08-10" }), period.periodStart, period.periodEnd)).toBe(true);
    expect(appliesInPeriod(once, give("o", { effectiveFrom: "2026-08-15" }), period.periodStart, period.periodEnd)).toBe(true);
    expect(appliesInPeriod(once, give("o", { effectiveFrom: "2026-07-15" }), period.periodStart, period.periodEnd)).toBe(false);
    expect(componentPay([rec, once], [give("r"), give("o", { effectiveFrom: "2026-08-15", amount: 6000 })], period).allowances).toBe(6100);
  });

  it("ignores assignments to a component that no longer exists", () => {
    expect(componentPay([], [give("gone")], period).lines).toEqual([]);
  });
});
