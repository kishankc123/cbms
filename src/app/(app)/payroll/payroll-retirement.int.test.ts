import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, complianceCountries, complianceTaxHeads, employees, journalLines, payrollLines, platformPayrollRuleVersions, platformSlabVersions, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { publishSlabVersion } from "@/lib/compliance/slabs";
import { publishRuleVersion } from "@/lib/payroll/platform-rules";
import { NEPAL_DEFAULT_RULES } from "@/lib/payroll/retirement-rules";
import { activePayrollEntries } from "@/lib/payroll/accrual";
import type { TdsWorking } from "@/lib/payroll/salary-tax-calc";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee } = await import("./employees/actions");
const { addRetirement, updateTaxInfo } = await import("./employees/actions");
const { generatePayrollRun, advanceRunStatus, reverseFinalizedRun } = await import("./salary-sheet/actions");
const { getContributions, payContributions } = await import("./contributions/actions");
const { voidPayment } = await import("@/lib/ledger/payments-engine");
const { loadLiabilities, loadRegistrations, loadReportLines } = await import("@/lib/payroll/payroll-report-data");
const reportsRules = await import("@/lib/payroll/payroll-reports");
const { getCashBankAccounts } = await import("@/lib/ledger/cash-bank-accounts");

// A throwaway country whose fiscal year is the calendar year, so the real countries, slabs and rules are never touched.
const CODE = "ZR";
const empInput = (code: string) => ({
  employeeCode: code, fullName: `Emp ${code}`, address: "", contactNumber: "", email: "", panNumber: "PAN1", joiningDate: "2026-01-01", leavingDate: "", department: "", designation: "",
  employmentType: "full_time" as const, employmentStatus: "active" as const, bankName: "", bankAccountNumber: "", initialSalary: 30000, taxStatus: "single",
});
const idOf = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0].id;
const lineOf = async (runId: string, employeeId: string) => (await db.select().from(payrollLines).where(and(eq(payrollLines.payrollRunId, runId), eq(payrollLines.employeeId, employeeId))))[0];
const finalize = async (runId: string) => {
  for (let i = 0; i < 3; i++) await advanceRunStatus({ runId });
};
// What the run's journal credited and debited, by account name.
async function journalOf(runId: string) {
  const [entry] = await activePayrollEntries(org.tenantId, runId);
  const rows = await db.select({ name: accounts.name, debit: journalLines.debitAmount, credit: journalLines.creditAmount }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.journalEntryId, entry.id));
  const byName: Record<string, { debit: number; credit: number }> = {};
  for (const r of rows) {
    byName[r.name] ??= { debit: 0, credit: 0 };
    byName[r.name].debit += Number(r.debit);
    byName[r.name].credit += Number(r.credit);
  }
  return { byName, debits: rows.reduce((s, r) => s + Number(r.debit), 0), credits: rows.reduce((s, r) => s + Number(r.credit), 0) };
}
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.02);

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Retirement test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1 }).onConflictDoNothing();
  await db.insert(complianceTaxHeads).values({ countryCode: CODE, key: "payroll", name: "Payroll", kind: "slabs", module: "payroll", sortOrder: 0 }).onConflictDoNothing();
  org = await createTempOrg("ZZ Payroll retirement");
  await db.update(tenants).set({ countryCode: CODE }).where(eq(tenants.id, org.tenantId));
  const single = [{ upTo: 100000, rate: 1 }, { upTo: 300000, rate: 10 }, { upTo: null, rate: 20 }];
  expect(await publishSlabVersion(org.userId, { countryCode: CODE, headKey: "payroll", effectiveFrom: "2026-01-01", tables: { single, couple: single }, isVerified: true, source: "test" })).toEqual({ ok: true });
  expect(await publishRuleVersion(org.userId, { countryCode: CODE, effectiveFrom: "2026-01-01", rules: NEPAL_DEFAULT_RULES, isVerified: true, source: "test" })).toEqual({ ok: true });
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_slabs"), eq(auditLog.entityId, `${CODE}:payroll`)));
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_payroll_rules"), eq(auditLog.entityId, CODE)));
  await org.remove();
  await db.delete(platformSlabVersions).where(eq(platformSlabVersions.countryCode, CODE));
  await db.delete(platformPayrollRuleVersions).where(eq(platformPayrollRuleVersions.countryCode, CODE));
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("retirement contributions in payroll", () => {
  let ssf: string, pf: string, none: string;
  let run: string;

  it("works out SSF and PF per employee, leaves everyone else untouched, and balances the journal", async () => {
    for (const c of ["E-SSF", "E-PF", "E-NONE"]) await createEmployee(empInput(c));
    [ssf, pf, none] = [await idOf("E-SSF"), await idOf("E-PF"), await idOf("E-NONE")];
    await addRetirement({ employeeId: ssf, scheme: "ssf", registrationNumber: "S-1", startDate: "2026-01-01", endDate: "", citMode: null, citValue: null, citEmployerValue: null, notes: "" });
    await addRetirement({ employeeId: pf, scheme: "pf", registrationNumber: "P-1", startDate: "2026-01-01", endDate: "", citMode: null, citValue: null, citEmployerValue: null, notes: "" });
    await updateTaxInfo({ employeeId: ssf, taxResidency: "resident", sstEligible: true });

    run = await generatePayrollRun({ month: 10, year: 2026, calendar: "AD", employeeIds: [ssf, pf, none] });
    const [a, b, c] = [await lineOf(run, ssf), await lineOf(run, pf), await lineOf(run, none)];
    // acceptance tests 1 and 2: SSF 3,300 + 6,000 and PF 3,000 + 3,000 on a basic of 30,000
    expect([Number(a.employeeRetirement), Number(a.employerRetirement)]).toEqual([3300, 6000]);
    expect([Number(b.employeeRetirement), Number(b.employerRetirement)]).toEqual([3000, 3000]);
    expect([Number(c.employeeRetirement), Number(c.employerRetirement), c.retirementDetail]).toEqual([0, 0, null]);
    // net pay falls by the employee's share only; the employer's share never touches it
    near(Number(a.netPay), 30000 - 3300 - Number(a.tdsAmount));
    near(Number(b.netPay), 30000 - 3000 - Number(b.tdsAmount));
    near(Number(c.netPay), 30000 - Number(c.tdsAmount));
  });

  it("takes the retirement deduction and the first-band exemption into the tax, only for who qualifies", async () => {
    const [a, b, c] = [await lineOf(run, ssf), await lineOf(run, pf), await lineOf(run, none)];
    const wa = a.tdsDetail as TdsWorking;
    const wb = b.tdsDetail as TdsWorking;
    // only October to December are projected (no earlier runs): 3 months of pay is 90,000, less 3 x 3,300 put aside
    expect(wa).toMatchObject({ retirementDeduction: 3300 * 3, taxableIncome: 90000 - 3300 * 3 });
    expect(wa.sstExemption).toBe(801); // the whole of the 1% first band on 80,100, so nothing is left to pay
    expect(wb.sstExemption ?? 0).toBe(0); // PF does not carry the exemption
    expect(Number(a.tdsAmount)).toBeLessThan(Number(b.tdsAmount));
    expect(Number(b.tdsAmount)).toBeLessThan(Number(c.tdsAmount));
  });

  it("posts one balanced entry with the contribution accounts, gratuity on its own", async () => {
    await finalize(run);
    const j = await journalOf(run);
    near(j.debits, j.credits);
    expect(j.byName["Salaries"].debit).toBe(90000);
    expect(j.byName["Employer Retirement Contributions"].debit).toBe(9000); // 6,000 SSF + 3,000 PF
    expect(j.byName["Employee SSF Payable"].credit).toBe(3300);
    expect(j.byName["Employer SSF Payable"].credit).toBe(3501);
    expect(j.byName["Gratuity Payable"].credit).toBe(2499);
    expect(j.byName["Employee PF Payable"].credit).toBe(3000);
    expect(j.byName["Employer PF Payable"].credit).toBe(3000);
    expect((await activePayrollEntries(org.tenantId, run)).length).toBe(1);
  });

  it("reversing takes everything back, and posting again does not duplicate anything", async () => {
    await reverseFinalizedRun({ runId: run, reason: "test" });
    expect((await activePayrollEntries(org.tenantId, run)).length).toBe(0);
    await finalize(run);
    expect((await activePayrollEntries(org.tenantId, run)).length).toBe(1);
    const j = await journalOf(run);
    expect(j.byName["Employee SSF Payable"].credit).toBe(3300);
    near(j.debits, j.credits);
  });

  it("shows what is owed to each fund, and paying SSF clears its three accounts through a real payment", async () => {
    const owed = async () => Object.fromEntries((await getContributions()).funds.map((f) => [f.key, Object.fromEntries(f.accounts.map((a) => [a.key, a.owed]))]));
    expect(await owed()).toEqual({ ssf: { employee_ssf: 3300, employer_ssf: 3501, gratuity: 2499 }, pf: { employee_pf: 3000, employer_pf: 3000 }, cit: { cit: 0 } });
    const [cash] = await getCashBankAccounts(org.tenantId);
    const base = { fund: "ssf" as const, paymentDate: "2026-11-05", accountId: cash.id, paymentMethod: "bank_transfer" as const, referenceNumber: "SSF-V1" };

    // more than is owed, an account from another fund, and nothing at all are refused
    await expect(payContributions({ ...base, parts: [{ account: "employee_ssf", amount: 9999 }] })).rejects.toThrow(/too much/);
    await expect(payContributions({ ...base, parts: [{ account: "employee_pf", amount: 100 }] })).rejects.toThrow(/does not belong/);
    await expect(payContributions({ ...base, parts: [] })).rejects.toThrow(/how much/);

    // pay SSF in two parts: all of the employee share and gratuity, and part of the employer share
    const r = await payContributions({ ...base, parts: [{ account: "employee_ssf", amount: 3300 }, { account: "employer_ssf", amount: 1000 }, { account: "gratuity", amount: 2499 }] });
    expect(r.duplicateWarning).toBe(false);
    expect(await owed()).toEqual({ ssf: { employee_ssf: 0, employer_ssf: 2501, gratuity: 0 }, pf: { employee_pf: 3000, employer_pf: 3000 }, cit: { cit: 0 } });
    const recent = (await getContributions()).recent;
    expect(recent[0]).toMatchObject({ amount: "6799.00", status: "posted", payee: "Social Security Fund (SSF)" });

    // voiding it puts everything back owed
    await voidPayment(org.tenantId, recent[0].id, org.userId, "test");
    expect(await owed()).toEqual({ ssf: { employee_ssf: 3300, employer_ssf: 3501, gratuity: 2499 }, pf: { employee_pf: 3000, employer_pf: 3000 }, cit: { cit: 0 } });
  });

  it("the reports read the finalized October run: contributions, tax, employer cost and what is owed", async () => {
    const lines = await loadReportLines(org.tenantId, { from: "2026-10-01", to: "2026-10-31" });
    expect(lines).toHaveLength(3);
    const regs = await loadRegistrations(org.tenantId);
    const ssfReport = reportsRules.contributionReport("ssf", lines, regs);
    expect(ssfReport.rows).toHaveLength(1);
    expect(ssfReport.rows[0]).toMatchObject({ registration: "S-1", employeeShare: 3300, employerShare: 6000, gratuity: 2499, total: 9300 });
    expect(reportsRules.contributionReport("pf", lines, regs).totals).toMatchObject({ employeeShare: 3000, employerShare: 3000 });
    // gross 90,000 plus 9,000 the employer adds
    expect(reportsRules.employerExpenseReport(lines).rows[0]).toMatchObject({ employees: 3, gross: 90000, employer: 9000, cost: 99000 });
    expect(reportsRules.annualTaxSummary(lines).totals).toMatchObject({ months: 3, gross: 90000, retirement: 6300 });
    // a range with no finalized run is empty, and another employee is filtered out
    expect(await loadReportLines(org.tenantId, { from: "2026-09-01", to: "2026-09-30" })).toEqual([]);
    expect(await loadReportLines(org.tenantId, { from: "2026-10-01", to: "2026-10-31" }, pf)).toHaveLength(1);
    // owed today: the retirement accounts hold what the October run put there
    const owed = Object.fromEntries((await loadLiabilities(org.tenantId)).map((i) => [i.label, i.amount]));
    expect(owed["SSF: Employee SSF Payable"]).toBe(3300);
    expect(owed["SSF: Gratuity Payable"]).toBe(2499);
    expect(owed["PF: Employer PF Payable"]).toBe(3000);
  });

  it("later months count what was already put aside, and a rule change does not touch a finished month", async () => {
    const nov = await generatePayrollRun({ month: 11, year: 2026, calendar: "AD", employeeIds: [ssf] });
    const w = (await lineOf(nov, ssf)).tdsDetail as TdsWorking;
    // 3,300 already put aside in October, plus 3,300 for each of the two months left (this one and December)
    expect(w.retirementActual).toBe(3300 * 3);
    // a new version of the rules from December leaves the finalized October figures alone
    const changed = { ...NEPAL_DEFAULT_RULES, schemes: { ...NEPAL_DEFAULT_RULES.schemes, pf: { ...NEPAL_DEFAULT_RULES.schemes.pf, lines: [{ key: "provident_fund", label: "Provident fund", employeePct: 12, employerPct: 10 }] } } };
    expect(await publishRuleVersion(org.userId, { countryCode: CODE, effectiveFrom: "2026-12-01", rules: changed, isVerified: true, source: "change" })).toEqual({ ok: true });
    const oct = await lineOf(run, pf);
    expect(Number(oct.employeeRetirement)).toBe(3000);
    const dec = await generatePayrollRun({ month: 12, year: 2026, calendar: "AD", employeeIds: [pf] });
    expect(Number((await lineOf(dec, pf)).employeeRetirement)).toBe(3600);
  });
});
