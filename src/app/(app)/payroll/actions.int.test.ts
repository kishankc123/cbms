import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, accountingPeriods, employees, journalEntries, payrollLines, payrollRuns } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "@/lib/ledger/payments-engine";
import { getEmployeePayableBalance, activePayrollEntries } from "@/lib/payroll/accrual";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee, updateEmployee } = await import("./employees/actions");
const { setAttendance } = await import("./employees/attendance-actions");
const { generatePayrollRun, advanceRunStatus, reverseFinalizedRun, revertRunToDraft } = await import("./salary-sheet/actions");

let cashId: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];

const empInput = (code: string, name: string, over: Partial<Parameters<typeof createEmployee>[0]> = {}) => ({
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
  initialSalary: 30000,
  ...over,
});
const findEmployee = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0];
const runOf = async (id: string) => (await db.select().from(payrollRuns).where(eq(payrollRuns.id, id)))[0];
async function finalize(runId: string) {
  await advanceRunStatus({ runId });
  await advanceRunStatus({ runId });
  await advanceRunStatus({ runId });
}
const salaryPayment = (employeeId: string, amount: number) =>
  createPayment(org.tenantId, org.userId, "TMP", { direction: "money_out", paymentType: "salary_payment", paymentDate: "2026-09-01", partyType: "employee", employeeId, accountId: cashId, paymentMethod: "cash", amount, confirmDuplicate: true });

beforeAll(async () => {
  org = await createTempOrg("ZZ Payroll Test");
  cashId = (await acct("1000")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("employees", () => {
  it("refuses a duplicate employee ID and a leaving date before the joining date", async () => {
    await createEmployee(empInput("E-1", "Asha"));
    await expect(createEmployee(empInput("E-1", "Someone Else"))).rejects.toThrow(/already used/);
    await expect(createEmployee(empInput("E-2", "Bikash", { leavingDate: "2025-12-31" }))).rejects.toThrow(/leaving date/);
    const asha = await findEmployee("E-1");
    await createEmployee(empInput("E-3", "Chandra"));
    await expect(updateEmployee({ ...empInput("E-1", "Chandra"), employeeId: (await findEmployee("E-3")).id })).rejects.toThrow(/already used/);
    expect(asha.payableAccountId).toBeTruthy();
  });

  it("renames the payable account when the employee is renamed", async () => {
    const e = await findEmployee("E-3");
    await updateEmployee({ ...empInput("E-3", "Chandra Renamed"), employeeId: e.id });
    const [a] = await db.select().from(accounts).where(eq(accounts.id, e.payableAccountId!));
    expect(a.name).toBe("Chandra Renamed");
  });
});

describe("payroll run lifecycle", () => {
  let runId: string;
  let ashaId: string;
  let net = 0;

  it("posts the salary entry when finalized, and the employee is owed their net pay", async () => {
    ashaId = (await findEmployee("E-1")).id;
    runId = await generatePayrollRun({ month: 6, year: 2026, calendar: "AD", employeeIds: [ashaId] });
    const [line] = await db.select().from(payrollLines).where(eq(payrollLines.payrollRunId, runId));
    net = Number(line.netPay);
    expect(net).toBeGreaterThan(0);

    await finalize(runId);
    expect((await runOf(runId)).status).toBe("finalized");
    expect((await activePayrollEntries(org.tenantId, runId)).length).toBe(1);
    expect(await getEmployeePayableBalance(org.tenantId, ashaId)).toBe(net);
  });

  it("refuses to regenerate or overlap a finalized run", async () => {
    await expect(generatePayrollRun({ month: 6, year: 2026, calendar: "AD", employeeIds: [ashaId] })).rejects.toThrow(/finalized/);
    // Baisakh-Jestha 2083 BS sits over the same real days as Jun 2026 in part
    await expect(generatePayrollRun({ month: 2, year: 2083, calendar: "BS", employeeIds: [ashaId] })).rejects.toThrow(/overlaps/);
  });

  it("refuses attendance changes inside a finalized run", async () => {
    await expect(setAttendance({ employeeId: ashaId, date: "2026-06-10", status: "absent" })).rejects.toThrow(/finalized payroll run/);
    await expect(revertRunToDraft({ runId })).rejects.toThrow(/finalized/);
  });

  it("a salary payment can't be more than what the employee is owed, and settles the payable", async () => {
    await expect(salaryPayment(ashaId, net + 1)).rejects.toThrow(/is owed/);
    await salaryPayment(ashaId, 1000);
    expect(await getEmployeePayableBalance(org.tenantId, ashaId)).toBe(net - 1000);
    // someone who is owed nothing can't be paid
    const chandra = await findEmployee("E-3");
    await expect(salaryPayment(chandra.id, 10)).rejects.toThrow(/isn't owed/);
  });

  it("can't reverse a run the employee has been paid out of; can once the payment is voided", async () => {
    await expect(reverseFinalizedRun({ runId, reason: "wrong basic" })).rejects.toThrow(/already been paid/);
    await expect(reverseFinalizedRun({ runId, reason: "  " })).rejects.toThrow(/reason/);

    const { payments } = await import("@/db/schema");
    const [p] = await db.select().from(payments).where(and(eq(payments.tenantId, org.tenantId), eq(payments.paymentType, "salary_payment")));
    await voidPayment(org.tenantId, p.id, org.userId, "test");
    expect(await getEmployeePayableBalance(org.tenantId, ashaId)).toBe(net);

    await reverseFinalizedRun({ runId, reason: "wrong basic" });
    expect((await runOf(runId)).status).toBe("draft");
    expect((await activePayrollEntries(org.tenantId, runId)).length).toBe(0);
    expect(await getEmployeePayableBalance(org.tenantId, ashaId)).toBe(0);

    // it can be corrected and finalized again — one entry in force, not two
    await finalize(runId);
    expect((await activePayrollEntries(org.tenantId, runId)).length).toBe(1);
    expect(await getEmployeePayableBalance(org.tenantId, ashaId)).toBe(net);
  });

  it("refuses to finalize when the run's period is closed, leaving the run unfinalized", async () => {
    const id = await generatePayrollRun({ month: 7, year: 2026, calendar: "AD", employeeIds: [ashaId] });
    await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: "2026-07-01", periodEnd: "2026-07-31", label: "Jul 2026", status: "closed" });
    await expect(finalize(id)).rejects.toThrow(/closed|locked/i);
    expect((await runOf(id)).status).not.toBe("finalized");
    expect((await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, id)))).length).toBe(0);
  });
});

describe("employment window", () => {
  it("leaves out someone who left before the period and pays a mid-period joiner only for their days", async () => {
    await createEmployee(empInput("E-4", "Left Early", { leavingDate: "2026-07-31" }));
    await createEmployee(empInput("E-5", "Joins Mid", { joiningDate: "2026-08-16" }));
    const id = await generatePayrollRun({ month: 8, year: 2026, calendar: "AD", employeeIds: [] });
    const lines = await db.select().from(payrollLines).where(eq(payrollLines.payrollRunId, id));
    const byEmployee = new Map(lines.map((l) => [l.employeeId, Number(l.netPay)]));
    expect(byEmployee.has((await findEmployee("E-4")).id)).toBe(false);
    const full = byEmployee.get((await findEmployee("E-1")).id)!;
    const joiner = byEmployee.get((await findEmployee("E-5")).id)!;
    expect(joiner).toBeGreaterThan(0);
    expect(joiner).toBeLessThan(full);
  });
});
