import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, complianceCountries, complianceTaxHeads, employees, journalEntries, journalLines, payrollLines, platformSlabVersions, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { publishSlabVersion } from "@/lib/compliance/slabs";
import type { TdsWorking } from "@/lib/payroll/salary-tax-calc";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee, addSalaryChange } = await import("./employees/actions");
const { generatePayrollRun, advanceRunStatus, reverseFinalizedRun } = await import("./salary-sheet/actions");

// A throwaway country whose fiscal year is the calendar year, so the real countries and slabs are never touched.
const CODE = "ZP";
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.025);

const empInput = (code: string, name: string, over: Record<string, unknown> = {}) => ({
  employeeCode: code,
  fullName: name,
  address: "",
  contactNumber: "",
  email: "",
  panNumber: "",
  joiningDate: "2026-01-01",
  leavingDate: "",
  department: "",
  designation: "",
  employmentType: "full_time" as const,
  employmentStatus: "active" as const,
  bankName: "",
  bankAccountNumber: "",
  initialSalary: 65000,
  taxStatus: "single",
  ...over,
});
const byCode = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0];
const lineOf = async (runId: string, employeeId: string) => (await db.select().from(payrollLines).where(and(eq(payrollLines.payrollRunId, runId), eq(payrollLines.employeeId, employeeId))))[0];
const tdsPayable = async () => {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.name, "TDS Payable — Salary")));
  if (!a) return { exists: false, balance: 0 };
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return { exists: true, balance: Number(row.v) };
};
async function finalize(runId: string) {
  for (let i = 0; i < 3; i++) await advanceRunStatus({ runId });
}
const rows = (...rates: number[]) => rates.map((rate, i) => ({ upTo: i === rates.length - 1 ? null : (i + 1) * 500000 - (i === 1 ? 300000 : 0), rate }));

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Payroll tax test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1 }).onConflictDoNothing();
  await db.insert(complianceTaxHeads).values({ countryCode: CODE, key: "payroll", name: "Payroll", kind: "slabs", module: "payroll", sortOrder: 0 }).onConflictDoNothing();
  org = await createTempOrg("ZZ Payroll TDS");
  await db.update(tenants).set({ countryCode: CODE }).where(eq(tenants.id, org.tenantId));
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_slabs"), eq(auditLog.entityId, `${CODE}:payroll`)));
  await org.remove();
  await db.delete(platformSlabVersions).where(eq(platformSlabVersions.countryCode, CODE));
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("salary TDS in payroll", () => {
  let sitaId: string;
  const runs: Record<number, string> = {};

  it("takes no TDS, and says why, while no slabs are published", async () => {
    await createEmployee(empInput("T-1", "Sita"));
    sitaId = (await byCode("T-1")).id;
    const runId = await generatePayrollRun({ month: 1, year: 2026, calendar: "AD", employeeIds: [sitaId] });
    const line = await lineOf(runId, sitaId);
    expect(Number(line.tdsAmount)).toBe(0);
    expect((line.tdsDetail as TdsWorking).missing).toBe("slabs");
    expect(Number(line.netPay)).toBe(Number(line.grossPay));
  });

  it("projects the year for each month, and remembers the slab version it used", async () => {
    // single: 1% to 500,000, 10% to 700,000... the table helper makes 3 slabs: up to 500,000 / 700,000 / above
    const single = [{ upTo: 500000, rate: 1 }, { upTo: 700000, rate: 10 }, { upTo: null, rate: 20 }];
    const couple = [{ upTo: null, rate: 0 }];
    expect(await publishSlabVersion(org.userId, { countryCode: CODE, headKey: "payroll", effectiveFrom: "2026-01-01", tables: { single, couple }, isVerified: true, source: "test" })).toEqual({ ok: true });

    runs[1] = await generatePayrollRun({ month: 1, year: 2026, calendar: "AD", employeeIds: [sitaId] });
    const line = await lineOf(runs[1], sitaId);
    const w = line.tdsDetail as TdsWorking;
    expect(w).toMatchObject({ taxpayerClass: "single", classAssumed: false, projected: 780000, annualTax: 41000, monthsLeft: 12, missing: null });
    expect(w.slabVersion?.label).toBe("v1 of 2026");
    near(Number(line.tdsAmount), 3416.67);
    near(Number(line.netPay), 65000 - 3416.67);
  });

  it("finalizing posts the TDS to its own payable account, and reversing takes it back", async () => {
    await finalize(runs[1]);
    const t = await tdsPayable();
    expect(t.exists).toBe(true);
    near(t.balance, 3416.67);
    await reverseFinalizedRun({ runId: runs[1], reason: "test" });
    near((await tdsPayable()).balance, 0);
    await finalize(runs[1]);
    near((await tdsPayable()).balance, 3416.67);
  });

  it("the next month takes off what was withheld; a raise raises only the months still to come", async () => {
    runs[2] = await generatePayrollRun({ month: 2, year: 2026, calendar: "AD", employeeIds: [sitaId] });
    const feb = await lineOf(runs[2], sitaId);
    expect((feb.tdsDetail as TdsWorking).monthsLeft).toBe(11);
    expect((feb.tdsDetail as TdsWorking).earnedBefore).toBe(65000);
    near(Number(feb.tdsAmount), 3416.67);
    await finalize(runs[2]);

    await addSalaryChange({ employeeId: sitaId, changeType: "new_fixed", changeValue: 0, newFixedSalary: 80000, effectiveFrom: "2026-03-01", reason: "raise", notes: "", replaceSameDate: false });
    runs[3] = await generatePayrollRun({ month: 3, year: 2026, calendar: "AD", employeeIds: [sitaId] });
    const mar = await lineOf(runs[3], sitaId);
    const w = mar.tdsDetail as TdsWorking;
    expect(w.projected).toBe(65000 * 2 + 80000 * 10); // 930,000: 5,000 + 20,000 + 46,000 = 71,000 for the year
    expect(w.annualTax).toBe(71000);
    near(Number(mar.tdsAmount), (71000 - 2 * 3416.67) / 10);
    expect(Number(feb.tdsAmount)).toBeLessThan(Number(mar.tdsAmount));
  });

  it("uses the Couple slabs for a couple, and flags an employee with no tax status (Single is used)", async () => {
    await createEmployee(empInput("T-2", "Ram", { taxStatus: "couple" }));
    await createEmployee(empInput("T-3", "Gita", { taxStatus: "" }));
    const ram = await byCode("T-2");
    const gita = await byCode("T-3");
    const runId = await generatePayrollRun({ month: 4, year: 2026, calendar: "AD", employeeIds: [ram.id, gita.id] });
    expect(Number((await lineOf(runId, ram.id)).tdsAmount)).toBe(0); // the couple table taxes nothing
    const g = await lineOf(runId, gita.id);
    expect(Number(g.tdsAmount)).toBeGreaterThan(0);
    expect(g.tdsDetail).toMatchObject({ taxpayerClass: "single", classAssumed: true });
  });

  it("counts income and tax from an earlier employer, but only in the year the person joined", async () => {
    await createEmployee(empInput("T-4", "Mina", { joiningDate: "2026-07-01", priorIncome: "300000", priorTds: "3000" }));
    const mina = await byCode("T-4");
    expect(Number(mina.priorIncome)).toBe(300000);
    const runId = await generatePayrollRun({ month: 7, year: 2026, calendar: "AD", employeeIds: [mina.id] });
    const w = (await lineOf(runId, mina.id)).tdsDetail as TdsWorking;
    expect(w).toMatchObject({ priorIncome: 300000, priorTds: 3000, monthsLeft: 6, projected: 300000 + 65000 * 6 });
    // an employee who joined in an earlier year never has the earlier-employer figures counted
    await createEmployee(empInput("T-7", "Old hand", { joiningDate: "2025-06-01", priorIncome: "999999", priorTds: "999" }));
    const old = await byCode("T-7");
    const oldRun = await generatePayrollRun({ month: 7, year: 2026, calendar: "AD", employeeIds: [old.id] });
    expect(((await lineOf(oldRun, old.id)).tdsDetail as TdsWorking).priorIncome).toBe(0);
  });

  it("refuses a tax status that is not Single or Couple, and negative earlier-employer amounts", async () => {
    await expect(createEmployee(empInput("T-5", "Bad", { taxStatus: "married" }))).rejects.toThrow(/Single or Couple/);
    await expect(createEmployee(empInput("T-6", "Bad2", { priorIncome: "-5" }))).rejects.toThrow(/zero or more/);
  });
});
