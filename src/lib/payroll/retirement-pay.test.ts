import { describe, expect, it } from "vitest";
import type { Enrolment } from "./employee-retirement";
import { creditsFor, enrolledDuring, retirementPay } from "./retirement-pay";
import { NEPAL_DEFAULT_RULES } from "./retirement-rules";

const enrol = (over: Partial<Enrolment>): Enrolment => ({ scheme: "ssf", registrationNumber: "S-1", startDate: "2026-07-17", endDate: null, citMode: null, citValue: null, citEmployerValue: null, ...over });
const base = { rules: NEPAL_DEFAULT_RULES, proratedBasic: 30000, retirementAllowances: 0, periodStart: "2026-10-01", periodEnd: "2026-10-31" };

describe("retirement pay for a period", () => {
  it("SSF on 30,000: employee 3,300, employer 6,000, and the journal balances", () => {
    const r = retirementPay({ ...base, enrolments: [enrol({})] });
    expect(r).toMatchObject({ employee: 3300, employer: 6000, inSsf: true, warnings: [] });
    // gratuity has an account of its own; the rest of the employer's share is Employer SSF Payable
    expect(creditsFor(r.lines)).toEqual({ employee_ssf: 3300, employer_ssf: 3501, gratuity: 2499 });
    const credits = Object.values(creditsFor(r.lines)).reduce((s, v) => s + (v ?? 0), 0);
    expect(credits).toBe(r.employee + r.employer);
  });

  it("PF on 30,000: 3,000 each", () => {
    const r = retirementPay({ ...base, enrolments: [enrol({ scheme: "pf" })] });
    expect(r).toMatchObject({ employee: 3000, employer: 3000, inSsf: false });
    expect(creditsFor(r.lines)).toEqual({ employee_pf: 3000, employer_pf: 3000 });
  });

  it("counts allowances flagged for retirement in the basis", () => {
    expect(retirementPay({ ...base, retirementAllowances: 10000, enrolments: [enrol({ scheme: "pf" })] }).employee).toBe(4000);
  });

  it("CIT sits beside SSF; employee and employer CIT share one account", () => {
    const r = retirementPay({ ...base, enrolments: [enrol({}), enrol({ scheme: "cit", registrationNumber: null, citMode: "percent", citValue: 5, citEmployerValue: 500 })] });
    expect(r).toMatchObject({ employee: 3300 + 1500, employer: 6000 + 500 });
    expect(creditsFor(r.lines).cit).toBe(2000);
  });

  it("an employee with no enrolment, or one that has ended, contributes nothing", () => {
    expect(retirementPay({ ...base, enrolments: [] })).toMatchObject({ lines: [], employee: 0, employer: 0 });
    expect(retirementPay({ ...base, enrolments: [enrol({ endDate: "2026-09-30" })] }).employee).toBe(0);
    // a scheme that ends mid-month still contributes for that month
    expect(retirementPay({ ...base, enrolments: [enrol({ endDate: "2026-10-10" })] }).employee).toBe(3300);
    expect(enrolledDuring(enrol({ startDate: "2026-11-01" }), "2026-10-01", "2026-10-31")).toBe(false);
  });

  it("takes nothing, and says why, with no rules or no SSF registration number", () => {
    expect(retirementPay({ ...base, rules: null, enrolments: [enrol({})] })).toMatchObject({ employee: 0, warnings: [expect.stringMatching(/No payroll rules/)] });
    expect(retirementPay({ ...base, enrolments: [enrol({ registrationNumber: null })] })).toMatchObject({ employee: 0, warnings: [expect.stringMatching(/registration number/)] });
  });
});
