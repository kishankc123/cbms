import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, employees, payments, payrollLines, staffAdvanceRecoveries, staffAdvances } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "@/lib/ledger/payments-engine";
import { getEmployeePayableBalance } from "@/lib/payroll/accrual";
import { getEmployeeAdvanceOutstanding } from "@/lib/payroll/staff-advances";
import { getEmployeeAdvanceBalance } from "@/lib/ledger/advance-accounts";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee } = await import("./employees/actions");
const { generatePayrollRun, advanceRunStatus, reverseFinalizedRun } = await import("./salary-sheet/actions");

let cashId: string;
let chandra: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];

const empInput = (code: string, name: string, over: Partial<Parameters<typeof createEmployee>[0]> = {}) => ({
  employeeCode: code, fullName: name, address: "", contactNumber: "", email: "", panNumber: "", joiningDate: "2026-01-01", leavingDate: "",
  department: "", designation: "", employmentType: "full_time" as const, employmentStatus: "active" as const, bankName: "", bankAccountNumber: "", initialSalary: 30000, ...over,
});
const findEmployee = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0];
async function finalize(runId: string) {
  await advanceRunStatus({ runId });
  await advanceRunStatus({ runId });
  await advanceRunStatus({ runId });
}
const lineOf = async (runId: string) => (await db.select().from(payrollLines).where(eq(payrollLines.payrollRunId, runId)))[0];
const advance = (employeeId: string, amount: number, date: string, month: number | null, year = 2026) =>
  createPayment(org.tenantId, org.userId, "TMP", {
    direction: "money_out", paymentType: "staff_advance", paymentDate: date, partyType: "employee", employeeId, accountId: cashId, paymentMethod: "cash", amount,
    advanceMonth: month === null ? null : { calendar: "AD", month, year }, confirmDuplicate: true,
  });
// What the ledger says the employee has been advanced must always equal what the advances say is still to recover.
async function expectConsistent(employeeId: string) {
  expect(await getEmployeeAdvanceBalance(org.tenantId, employeeId)).toBe(await getEmployeeAdvanceOutstanding(org.tenantId, employeeId));
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Staff Advance Test");
  cashId = (await acct("1000")).id;
  await createEmployee(empInput("A-1", "Chandra"));
  chandra = (await findEmployee("A-1")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("staff advances", () => {
  let sepAdvancePayment: string;
  let sepRun: string;
  let sepNet = 0;

  it("records the advance on the employee's own Staff Advance account, and refuses bad ones", async () => {
    const sep = await advance(chandra, 5000, "2026-09-05", 9);
    sepAdvancePayment = "paymentId" in sep ? sep.paymentId : "";
    await advance(chandra, 60000, "2026-09-06", 10);
    expect(await getEmployeeAdvanceBalance(org.tenantId, chandra)).toBe(65000);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(65000);

    await expect(advance(chandra, 100, "2026-09-05", null)).rejects.toThrow(/month/i);
    await createEmployee(empInput("A-2", "Late Joiner", { joiningDate: "2026-08-16" }));
    await expect(advance((await findEmployee("A-2")).id, 100, "2026-08-01", 8)).rejects.toThrow(/hadn't joined/);
    await createEmployee(empInput("A-3", "Gone", { leavingDate: "2026-06-30" }));
    await expect(advance((await findEmployee("A-3")).id, 100, "2026-09-05", 9)).rejects.toThrow(/already left/);
  });

  it("is taken out of that month's salary sheet (only that month's, and never more than take-home)", async () => {
    sepRun = await generatePayrollRun({ month: 9, year: 2026, calendar: "AD", employeeIds: [chandra] });
    const line = await lineOf(sepRun);
    // the October advance is not touched by September's pay
    expect(Number(line.advanceRecovered)).toBe(5000);
    expect(Number(line.netPay)).toBe(Number(line.grossPay) - Number(line.deductions) - 5000);
    sepNet = Number(line.netPay);

    await finalize(sepRun);
    expect(await getEmployeePayableBalance(org.tenantId, chandra)).toBe(sepNet);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(60000);
    await expectConsistent(chandra);
  });

  it("can't be voided once payroll has recovered part of it", async () => {
    await expect(voidPayment(org.tenantId, sepAdvancePayment, org.userId, "test")).rejects.toThrow(/recovered through payroll/);
  });

  it("recovers what one month's pay can't cover from the next months, and never makes net pay negative", async () => {
    const octRun = await generatePayrollRun({ month: 10, year: 2026, calendar: "AD", employeeIds: [chandra] });
    const oct = await lineOf(octRun);
    const takeHome = Number(oct.grossPay) - Number(oct.deductions);
    expect(Number(oct.advanceRecovered)).toBe(takeHome); // 60000 outstanding, only this much is taken home
    expect(Number(oct.netPay)).toBe(0);
    await finalize(octRun);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(60000 - takeHome);
    await expectConsistent(chandra);

    const novRun = await generatePayrollRun({ month: 11, year: 2026, calendar: "AD", employeeIds: [chandra] });
    const nov = await lineOf(novRun);
    expect(Number(nov.advanceRecovered)).toBe(60000 - takeHome);
    await finalize(novRun);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(0);
    expect(await getEmployeeAdvanceBalance(org.tenantId, chandra)).toBe(0);
    // only September's net pay is owed to the employee; October's and part of November's went to clearing the advance
    expect(await getEmployeePayableBalance(org.tenantId, chandra)).toBe(sepNet + Number(nov.netPay));
  });

  it("a draft run can't be finalized with out-of-date advances; regenerating brings it up to date", async () => {
    const decRun = await generatePayrollRun({ month: 12, year: 2026, calendar: "AD", employeeIds: [chandra] });
    expect(Number((await lineOf(decRun)).advanceRecovered)).toBe(0);
    await advance(chandra, 1000, "2026-09-07", 12);
    await expect(finalize(decRun)).rejects.toThrow(/regenerate/);
    await generatePayrollRun({ month: 12, year: 2026, calendar: "AD", employeeIds: [chandra] });
    expect(Number((await lineOf(decRun)).advanceRecovered)).toBe(1000);
  });

  it("reversing a run gives its advance back, after which the advance can be voided", async () => {
    await reverseFinalizedRun({ runId: sepRun, reason: "test" });
    expect((await db.select().from(staffAdvanceRecoveries).where(eq(staffAdvanceRecoveries.payrollRunId, sepRun))).length).toBe(0);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(5000 + 1000);
    await expectConsistent(chandra);

    await voidPayment(org.tenantId, sepAdvancePayment, org.userId, "test");
    const [adv] = await db.select().from(staffAdvances).where(eq(staffAdvances.paymentId, sepAdvancePayment));
    expect(adv.status).toBe("void");
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(1000);
    await expectConsistent(chandra);
    const [p] = await db.select().from(payments).where(eq(payments.id, sepAdvancePayment));
    expect(p.status).toBe("voided");
  });
});
