import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, employees, journalEntries, journalLines, payrollLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee } = await import("./employees/actions");
const { generatePayrollRun, advanceRunStatus } = await import("./salary-sheet/actions");
const { createHeadingAction, createRoundAction, saveRoundAction, setRoundStatusAction, deleteHeadingAction } = await import("./incentives/actions");
const { listHeadings } = await import("@/lib/payroll/incentives");

const empInput = (code: string, name: string) => ({
  employeeCode: code, fullName: name, address: "", contactNumber: "", email: "", panNumber: "", joiningDate: "2026-01-01", leavingDate: "", department: "", designation: "",
  employmentType: "full_time" as const, employmentStatus: "active" as const, bankName: "", bankAccountNumber: "", initialSalary: 60000, taxStatus: "single",
});
const idOf = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0].id;
const lineOf = async (runId: string, employeeId: string) => (await db.select().from(payrollLines).where(and(eq(payrollLines.payrollRunId, runId), eq(payrollLines.employeeId, employeeId))))[0];

let headingId: string;
let roundId: string;
let runId: string;
let asha: string;
let bikram: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Incentives");
  await createEmployee(empInput("I-1", "Asha"));
  await createEmployee(empInput("I-2", "Bikram"));
  [asha, bikram] = [await idOf("I-1"), await idOf("I-2")];
});
afterAll(async () => {
  await org.remove();
});

describe("performance incentives", () => {
  it("a heading gets its own expense account under Salaries > Performance incentives", async () => {
    await createHeadingAction({ name: "Sales incentive", frequency: "monthly", taxable: true, countsForRetirement: false });
    const [h] = await listHeadings(org.tenantId);
    headingId = h.id;
    const all = await db.select().from(accounts).where(eq(accounts.tenantId, org.tenantId));
    const account = all.find((a) => a.id === h.accountId)!;
    const group = all.find((a) => a.id === account.parentAccountId)!;
    const salaries = all.find((a) => a.id === group.parentAccountId)!;
    expect([salaries.name, group.name, account.name]).toEqual(["Salaries", "Performance incentives", "Sales incentive"]);
    expect(account.category).toBe("expense");
    await expect(createHeadingAction({ name: "sales incentive ", frequency: "monthly", taxable: true, countsForRetirement: false })).rejects.toThrow(/already an incentive heading|duplicate|already/i);
  });

  it("a draft round is not paid; an approved one is, as one line per heading, several entries adding up", async () => {
    roundId = await createRoundAction({ headingId, calendarSystem: "AD", year: 2026, month: 3, periodLabel: "March 2026", note: "" });
    await expect(createRoundAction({ headingId, calendarSystem: "AD", year: 2026, month: 3, periodLabel: "march 2026", note: "" })).rejects.toThrow(/already has a round/);
    await saveRoundAction({ roundId, entries: [{ employeeId: asha, amount: 5000, note: "Target 1" }, { employeeId: asha, amount: 2500, note: "Target 2" }, { employeeId: bikram, amount: 4000, note: "" }] });

    runId = await generatePayrollRun({ month: 3, year: 2026, calendar: "AD", employeeIds: [asha, bikram] });
    expect(Number((await lineOf(runId, asha)).incentives)).toBe(0); // still a draft

    const { status } = await saveRoundAction({ roundId, entries: [{ employeeId: asha, amount: 5000, note: "Target 1" }, { employeeId: asha, amount: 2500, note: "Target 2" }, { employeeId: bikram, amount: 4000, note: "" }], approve: true });
    expect(status).toBe("approved");
    // approving worked the open salary sheet out again by itself
    const a = await lineOf(runId, asha);
    const b = await lineOf(runId, bikram);
    expect(Number(a.incentives)).toBe(7500);
    expect(Number(a.grossPay)).toBe(67500);
    expect(Number(a.taxablePay)).toBe(67500);
    expect(a.incentivesDetail).toEqual([expect.objectContaining({ name: "Sales incentive", amount: 7500, taxable: true })]);
    expect(Number(b.grossPay)).toBe(64000);
  });

  it("taking a round back to a draft removes it from the salary sheet", async () => {
    await setRoundStatusAction({ roundId, status: "draft" });
    expect(Number((await lineOf(runId, asha)).incentives)).toBe(0);
    await setRoundStatusAction({ roundId, status: "approved" });
    expect(Number((await lineOf(runId, asha)).incentives)).toBe(7500);
  });

  it("finalizing posts basic salary and each incentive heading to their own accounts, in one balanced entry", async () => {
    await advanceRunStatus({ runId }); // approved
    await advanceRunStatus({ runId }); // finalized
    const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId)));
    expect(entries).toHaveLength(1);
    const lines = await db.select({ account: accounts.name, parent: accounts.parentAccountId, debit: journalLines.debitAmount, credit: journalLines.creditAmount }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.journalEntryId, entries[0].id));
    const debit = (name: string) => lines.filter((l) => l.account === name).reduce((s, l) => s + Number(l.debit), 0);
    expect(debit("Basic salary")).toBe(120000);
    expect(debit("Sales incentive")).toBe(11500);
    expect(debit("Salaries")).toBe(0);
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(Math.round(totalDebit * 100)).toBe(Math.round(totalCredit * 100));
  });

  it("a round paid in a finalized run can't be changed or deleted, and its heading can't be deleted", async () => {
    await expect(saveRoundAction({ roundId, entries: [{ employeeId: asha, amount: 1, note: "" }] })).rejects.toThrow(/finalized/);
    await expect(setRoundStatusAction({ roundId, status: "draft" })).rejects.toThrow(/finalized/);
    await expect(deleteHeadingAction({ id: headingId })).rejects.toThrow(/already has rounds/);
  });
});
