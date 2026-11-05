import { describe, expect, it } from "vitest";
import { annualReconciliation, annualTaxSummary, contributionReport, employerExpenseReport, liabilityReport, monthlyTdsReport, netSalaryPaymentReport, type ReportLine } from "./payroll-reports";
import type { TdsWorking } from "./salary-tax-calc";

const line = (over: Partial<ReportLine>): ReportLine => ({
  runId: "r1", periodStart: "2026-10-01", periodEnd: "2026-10-31", period: "October 2026", employeeId: "e1", employeeCode: "E-1", fullName: "Asha", panNumber: "111",
  basic: 30000, gross: 30000, taxablePay: 30000, tds: 0, advance: 0, otherDeductions: 0, employeeRetirement: 0, employerRetirement: 0, retirement: [], tdsDetail: null, net: 30000, ...over,
});
const ssf = [
  { scheme: "ssf" as const, key: "provident_fund", label: "Provident fund", employee: 3000, employer: 3000 },
  { scheme: "ssf" as const, key: "gratuity", label: "Gratuity", employee: 0, employer: 2499 },
  { scheme: "ssf" as const, key: "other", label: "Other", employee: 300, employer: 501 },
];

describe("payroll reports", () => {
  const asha = line({ employeeRetirement: 3300, employerRetirement: 6000, retirement: ssf, net: 26700 });
  const bikram = line({ employeeId: "e2", employeeCode: "E-2", fullName: "Bikram", retirement: [{ scheme: "pf", key: "provident_fund", label: "Provident fund", employee: 3000, employer: 3000 }], employeeRetirement: 3000, employerRetirement: 3000, net: 27000 });
  const nov = line({ runId: "r2", periodStart: "2026-11-01", periodEnd: "2026-11-30", period: "November 2026", employeeRetirement: 3300, employerRetirement: 6000, retirement: ssf, net: 26700 });

  it("SSF report lists only the people in SSF, with gratuity shown and totals that add up", () => {
    const t = contributionReport("ssf", [asha, bikram, nov], new Map([["e1:ssf", "S-1"]]));
    expect(t.rows.map((r) => [r.period, r.registration, r.employeeShare, r.employerShare, r.gratuity, r.total])).toEqual([["October 2026", "S-1", 3300, 6000, 2499, 9300], ["November 2026", "S-1", 3300, 6000, 2499, 9300]]);
    expect(t.totals).toMatchObject({ employeeShare: 6600, employerShare: 12000, total: 18600 });
  });

  it("PF report has no gratuity column, and CIT is empty when nobody is in it", () => {
    const t = contributionReport("pf", [asha, bikram], new Map());
    expect(t.columns.map((c) => c.key)).not.toContain("gratuity");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ employee: "E-2 Bikram", employeeShare: 3000, total: 6000 });
    expect(contributionReport("cit", [asha, bikram], new Map())).toMatchObject({ rows: [], totals: null });
  });

  it("monthly tax and annual summary add up per month and per employee", () => {
    const rows = [line({ tds: 500, taxablePay: 28000 }), line({ runId: "r2", periodEnd: "2026-11-30", period: "November 2026", tds: 500, taxablePay: 28000 })];
    expect(monthlyTdsReport(rows).totals).toMatchObject({ taxablePay: 56000, tds: 1000 });
    expect(annualTaxSummary(rows).rows[0]).toMatchObject({ months: 2, gross: 60000, tds: 1000, net: 60000 });
  });

  it("reconciliation compares the year's tax with what was withheld, including earlier months and the earlier employer", () => {
    const w = { projected: 360000, retirementDeduction: 9900, sstExemption: 0, annualTax: 33000, withheldBefore: 20000, priorTds: 1000 } as TdsWorking;
    const t = annualReconciliation([line({ tds: 2000, tdsDetail: w })]);
    expect(t.rows[0]).toMatchObject({ projected: 360000, retirement: 9900, annualTax: 33000, withheld: 23000, difference: 10000 });
    // excess withholding shows as a negative difference
    expect(annualReconciliation([line({ tds: 2000, tdsDetail: { ...w, annualTax: 20000 } })]).rows[0].difference).toBe(-3000);
  });

  it("employer expense adds the employer's contributions to gross pay, per month", () => {
    const t = employerExpenseReport([asha, bikram, nov]);
    expect(t.rows).toEqual([
      { period: "October 2026", employees: 2, gross: 60000, employer: 9000, cost: 69000 },
      { period: "November 2026", employees: 1, gross: 30000, employer: 6000, cost: 36000 },
    ]);
  });

  it("net salary payments show paid and still owed, and liabilities total", () => {
    const t = netSalaryPaymentReport([asha, bikram], new Map([["e1", 20000]]), new Map([["e1", 6700], ["e2", 27000]]));
    expect(t.totals).toMatchObject({ net: 53700, paid: 20000, owed: 33700 });
    expect(liabilityReport([{ label: "Salary payable", amount: 33700 }, { label: "TDS payable", amount: 500.5 }]).totals).toMatchObject({ amount: 34200.5 });
  });
});
