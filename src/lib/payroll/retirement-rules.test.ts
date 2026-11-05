import { describe, expect, it } from "vitest";
import { checkPayrollRules, computeCit, computeContribution, NEPAL_DEFAULT_RULES, retirementDeduction, sstExemption } from "./retirement-rules";
import { computeMonthlyTds } from "./salary-tax-calc";
import { slabTax } from "@/lib/compliance/slab-tables";

const rules = NEPAL_DEFAULT_RULES;
// The specification's FY 2083/84 bands for one person.
const bands = [{ upTo: 1000000, rate: 1 }, { upTo: 1500000, rate: 10 }, { upTo: 2500000, rate: 20 }, { upTo: 4000000, rate: 27 }, { upTo: null, rate: 29 }];

describe("SSF and PF contributions", () => {
  it("SSF on 30,000 basic: employee 3,300, employer 6,000, total 9,300", () => {
    const c = computeContribution(rules.schemes.ssf, 30000);
    expect(c).toMatchObject({ employee: 3300, employer: 6000, total: 9300 });
    expect(c.lines.map((l) => [l.key, l.employee, l.employer])).toEqual([["provident_fund", 3000, 3000], ["gratuity", 0, 2499], ["other", 300, 501]]);
  });

  it("PF on 30,000 basic: employee 3,000, employer 3,000, total 6,000", () => {
    expect(computeContribution(rules.schemes.pf, 30000)).toMatchObject({ employee: 3000, employer: 3000, total: 6000 });
  });

  it("rounds each line to the cent and respects a monthly cap on the basis", () => {
    expect(computeContribution(rules.schemes.ssf, 12345.67).employee).toBe(1358.03); // 1,234.57 + 123.46, each line rounded on its own
    const capped = { ...rules.schemes.pf, monthlyBasisCap: 20000 };
    expect(computeContribution(capped, 30000)).toMatchObject({ basis: 20000, employee: 2000, employer: 2000 });
  });

  it("never goes below zero", () => {
    expect(computeContribution(rules.schemes.ssf, -5)).toMatchObject({ employee: 0, employer: 0 });
  });
});

describe("CIT", () => {
  it("takes a fixed sum or a percentage, held to the monthly ceiling", () => {
    expect(computeCit({ mode: "fixed", value: 2000 }, 30000, rules.cit)).toMatchObject({ employee: 2000, employer: 0 });
    expect(computeCit({ mode: "percent", value: 5, employerValue: 500 }, 30000, rules.cit)).toMatchObject({ employee: 1500, employer: 500 });
    expect(computeCit({ mode: "fixed", value: 9000 }, 30000, { ...rules.cit, monthlyCeiling: 5000 })).toMatchObject({ employee: 5000, cappedByCeiling: true });
    expect(computeCit({ mode: "fixed", value: 100, employerValue: 500 }, 30000, { ...rules.cit, employerContributionAllowed: false }).employer).toBe(0);
  });
});

describe("deduction for retirement savings", () => {
  const limits = rules.retirementDeduction;
  it("is the least of the actual amount, one third of assessable income and the yearly cap", () => {
    expect(retirementDeduction(100000, 1800000, limits)).toEqual({ allowed: 100000, limitedBy: "actual" });
    expect(retirementDeduction(500000, 1200000, limits)).toEqual({ allowed: 400000, limitedBy: "income_share" });
    expect(retirementDeduction(900000, 3000000, limits)).toEqual({ allowed: 500000, limitedBy: "annual_cap" });
    expect(retirementDeduction(0, 3000000, limits)).toEqual({ allowed: 0, limitedBy: "none" });
  });
});

describe("progressive tax and the first-band exemption", () => {
  it("taxes 18,00,000 slab by slab: 10,000 + 50,000 + 60,000 = 1,20,000", () => {
    expect(slabTax(bands, 1800000)).toBe(120000);
  });

  it("waives only the first band for an eligible employee, so it is not charged twice", () => {
    expect(sstExemption(bands, 1800000, 1)).toBe(10000);
    const eligible = computeMonthlyTds({ taxablePay: 150000, earnedBefore: 0, withheldBefore: 0, priorIncome: 0, priorTds: 0, monthsLeft: 12, slabs: bands, rounding: "none", sstExemptBands: 1 });
    expect(eligible).toMatchObject({ projected: 1800000, annualTax: 110000, sstExemption: 10000 });
    const notEligible = computeMonthlyTds({ taxablePay: 150000, earnedBefore: 0, withheldBefore: 0, priorIncome: 0, priorTds: 0, monthsLeft: 12, slabs: bands, rounding: "none" });
    expect(notEligible.annualTax).toBe(120000);
    expect(notEligible.sstExemption).toBeUndefined();
  });

  it("never waives more than the tax itself", () => {
    expect(sstExemption(bands, 300000, 1)).toBe(3000);
    expect(computeMonthlyTds({ taxablePay: 25000, earnedBefore: 0, withheldBefore: 0, priorIncome: 0, priorTds: 0, monthsLeft: 12, slabs: bands, rounding: "none", sstExemptBands: 1 }).annualTax).toBe(0);
  });
});

describe("annual tax with retirement savings, raises and bonuses", () => {
  const input = { earnedBefore: 0, withheldBefore: 0, priorIncome: 0, priorTds: 0, monthsLeft: 12, slabs: bands, rounding: "none" };
  it("takes the capped retirement deduction off before the slabs", () => {
    const r = computeMonthlyTds({ ...input, taxablePay: 150000, retirement: { actualAnnual: 396000, limits: rules.retirementDeduction } });
    expect(r).toMatchObject({ projected: 1800000, retirementDeduction: 396000, retirementLimitedBy: "actual", taxableIncome: 1404000 });
    expect(r.annualTax).toBe(slabTax(bands, 1404000));
  });

  it("a raise or a bonus part-way through the year changes what is left to withhold", () => {
    const before = computeMonthlyTds({ ...input, taxablePay: 100000, earnedBefore: 600000, withheldBefore: 3000, monthsLeft: 6 });
    const bonus = computeMonthlyTds({ ...input, taxablePay: 100000 + 300000, earnedBefore: 600000, withheldBefore: 3000, monthsLeft: 6 });
    expect(bonus.tds).toBeGreaterThan(before.tds);
  });

  it("excess tax already withheld means nothing more is withheld, never a negative figure", () => {
    expect(computeMonthlyTds({ ...input, taxablePay: 100000, withheldBefore: 500000 }).tds).toBe(0);
  });
});

describe("the rule document", () => {
  it("accepts the Nepal defaults", () => {
    expect(checkPayrollRules(rules).ok).toBe(true);
  });
  it("rejects nonsense", () => {
    expect(checkPayrollRules(null).ok).toBe(false);
    expect(checkPayrollRules({ ...rules, retirementDeduction: { incomeShare: { num: 3, den: 1 }, annualCap: 1 } }).ok).toBe(false);
    expect(checkPayrollRules({ ...rules, schemes: { ...rules.schemes, pf: { ...rules.schemes.pf, lines: [{ key: "a", label: "A", employeePct: 120, employerPct: 0 }] } } }).ok).toBe(false);
    expect(checkPayrollRules({ ...rules, sst: { exemptBands: -1 } }).ok).toBe(false);
  });
});
