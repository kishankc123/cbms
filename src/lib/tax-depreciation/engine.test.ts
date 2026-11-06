import { describe, expect, it } from "vitest";
import { computePool, individualRatePercent } from "./engine";
import { additionDate, taxYearOf, timingThirds } from "./dates";
import { checkTaxDepreciationRules, NEPAL_TAX_DEPRECIATION_RULES as rules } from "./rules";

const poolB = rules.pools.find((p) => p.key === "B")!;
const poolA = rules.pools.find((p) => p.key === "A")!;
const poolE = rules.pools.find((p) => p.key === "E")!;
const base = { rules, openingWdv: 0, additions: [], priorDeferred: [], statutory: [], disposals: [], dissolved: false };

describe("dates", () => {
  it("places a date in its tax year and timing band", () => {
    expect(timingThirds("2025-08-01", rules)).toBe(3); // Shrawan
    expect(timingThirds("2026-03-01", rules)).toBe(2); // Falgun
    expect(timingThirds("2026-06-01", rules)).toBe(1); // Jestha
    const ty = taxYearOf("2026-03-01", rules)!;
    expect(ty.startYear).toBe(2082);
    expect(ty.from <= "2026-03-01" && ty.to >= "2026-03-01").toBe(true);
  });
  it("uses the later of entering the class and the cost being incurred", () => {
    expect(additionDate("2026-01-10", "2026-02-20")).toBe("2026-02-20");
    expect(additionDate("2026-05-01", "2026-02-20")).toBe("2026-05-01");
    expect(additionDate(null, "2026-02-20")).toBe("2026-02-20");
  });
});

describe("a pooled class", () => {
  it("adds only part of a late addition and carries the rest to next year", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 100000, additions: [{ id: "a", label: "Computer", cost: 60000, date: "2026-03-01" }] });
    expect(r.additionLines[0]).toMatchObject({ thirds: 2, currentYear: 40000, deferred: 20000 });
    expect(r.depreciationBase).toBe(140000);
    expect(r.normalDepreciation).toBe(35000);
    expect(r.closingWdv).toBe(105000);
    expect(r.deferredCarriedForward).toBe(20000);
  });
  it("brings deferred additions from last year into the base", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 105000, priorDeferred: [{ id: "d", amount: 20000 }] });
    expect(r.depreciationBase).toBe(125000);
    expect(r.closingWdv).toBe(93750);
  });
  it("writes off a small remainder under the limit, but not a balance of exactly nothing", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 2400 });
    expect(r).toMatchObject({ normalDepreciation: 600, additionalDepreciation: 1800, closingWdv: 0, dissolved: false });
    expect(computePool({ ...base, pool: poolB }).additionalDepreciation).toBe(0);
  });
  it("shows proceeds above the pool as a balancing charge, never dropping them", () => {
    const r = computePool({ ...base, pool: poolA, openingWdv: 50000, disposals: [{ assetId: "x", proceeds: 80000, date: "2026-03-01" }] });
    expect(r).toMatchObject({ depreciationBase: 0, balancingCharge: 30000, totalDeduction: 0, closingWdv: 0 });
    expect(r.reviewFlags.join(" ")).toMatch(/balancing charge/);
  });
  it("takes proceeds off the base when the pool is larger", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 100000, disposals: [{ assetId: "x", proceeds: 20000, date: "2026-03-01" }] });
    expect(r).toMatchObject({ depreciationBase: 80000, normalDepreciation: 20000, balancingCharge: 0 });
  });
  it("keeps a disposed asset's deferred part in the pool and flags it", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 100000, additions: [{ id: "a", label: "Laptop", cost: 30000, date: "2026-03-01" }], disposals: [{ assetId: "z", proceeds: 1000, date: "2026-04-01" }] });
    expect(r.deferredCarriedForward).toBe(10000);
    expect(r.reviewFlags.join(" ")).toMatch(/deferred/);
  });
});

describe("a dissolved class", () => {
  it("is a terminal deduction when the value is above the proceeds, including deferred additions", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 50000, additions: [{ id: "a", label: "x", cost: 30000, date: "2026-03-01" }], disposals: [{ assetId: "a", proceeds: 10000, date: "2026-05-01" }], dissolved: true });
    // value = 50000 + 20000 this year + 10000 deferred = 80000
    expect(r).toMatchObject({ normalDepreciation: 0, terminalDeduction: 70000, balancingCharge: 0, closingWdv: 0, deferredCarriedForward: 0 });
  });
  it("is a balancing charge when the proceeds are above the value", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 20000, disposals: [{ assetId: "a", proceeds: 50000, date: "2026-05-01" }], dissolved: true });
    expect(r).toMatchObject({ balancingCharge: 30000, terminalDeduction: 0 });
  });
  it("a zero balance on its own is not a dissolution", () => {
    expect(computePool({ ...base, pool: poolB, openingWdv: 0 }).dissolved).toBe(false);
  });
});

describe("an intangible asset", () => {
  it("takes its rate from the period of use to the nearest half year, with no small-balance write-off", () => {
    expect(individualRatePercent(5)).toBe(20);
    expect(individualRatePercent(7.3)).toBe(13.33); // 7.5 years
    const r = computePool({ ...base, pool: poolE, periodOfUseYears: 5, openingWdv: 1500 });
    expect(r).toMatchObject({ ratePercent: 20, normalDepreciation: 300, additionalDepreciation: 0, closingWdv: 1200 });
    expect(() => computePool({ ...base, pool: poolE, openingWdv: 100 })).toThrow(/period of use/);
  });
  it("uses the same addition timing", () => {
    const r = computePool({ ...base, pool: poolE, periodOfUseYears: 10, additions: [{ id: "s", label: "Software", cost: 90000, date: "2026-06-01" }] });
    expect(r.additionLines[0]).toMatchObject({ thirds: 1, currentYear: 30000, deferred: 60000 });
    expect(r.normalDepreciation).toBe(3000);
  });
});

describe("statutory additions and concessions", () => {
  it("adds a documented statutory addition and refuses an undocumented one", () => {
    const s = { type: "repair_excess", label: "Repairs", amount: 10000, legalReference: "Section 16(3)", evidence: "Ledger 5310" };
    expect(computePool({ ...base, pool: poolB, statutory: [s] }).depreciationBase).toBe(10000);
    expect(() => computePool({ ...base, pool: poolB, statutory: [{ ...s, evidence: "" }] })).toThrow(/evidence/);
  });
  it("ignores a concession that is not confirmed with documents, and flags it", () => {
    const add = [{ id: "p", label: "Fiscal printer", cost: 40000, date: "2026-03-01", concessionKey: "fiscal_printer_full" }];
    const off = computePool({ ...base, pool: poolB, additions: add, concessions: [{ key: "fiscal_printer_full", confirmed: false, documentation: "" }] });
    expect(off.sameYearDeductions).toBe(0);
    expect(off.reviewFlags.join(" ")).toMatch(/not applied/);
    const on = computePool({ ...base, pool: poolB, additions: add, concessions: [{ key: "fiscal_printer_full", confirmed: true, documentation: "IRD letter" }] });
    expect(on).toMatchObject({ sameYearDeductions: 40000, currentYearAdditions: 0, totalDeduction: 40000 });
  });
  it("raises the rate by a third when confirmed", () => {
    const r = computePool({ ...base, pool: poolB, openingWdv: 90000, concessions: [{ key: "extra_third_rate", confirmed: true, documentation: "Approval" }] });
    expect(r.ratePercent).toBe(33.33);
  });
});

describe("the rules themselves", () => {
  it("accept Nepal's and reject a gap in the timing bands", () => {
    expect(checkTaxDepreciationRules(rules).ok).toBe(true);
    const bad = { ...rules, timing: rules.timing.slice(0, 2) };
    expect(checkTaxDepreciationRules(bad)).toMatchObject({ ok: false });
  });
});
