import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, employees, journalLines, payrollLines, staffAccountMoves } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { useCountryWithoutSlabs } from "@/test/no-slabs-country";
import { createPayment } from "@/lib/ledger/payments-engine";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry } from "@/lib/ledger/post";
import { balanceSheet } from "@/lib/ledger/reports";
import { getStaffBalance } from "@/lib/payroll/staff-account";
import { draftOverpaidAdjustments, overpaidStaff } from "@/lib/payroll/overpaid";
import { mergeStaffAccounts, planStaffAccountMerge, undoStaffAccountMerge } from "@/lib/payroll/merge-staff-accounts";
import { payrollRuns } from "@/db/schema";

// One account per employee: advances and salary payments are debited to it and salary earned credited, with no limit on what can be paid. What is paid beyond the
// advances waiting for their month is flagged as overpaid and comes off the next payslip. History on the old separate advance account can be moved across and back.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let org: Awaited<ReturnType<typeof createTempOrg>>;
let dropCountry: () => Promise<void>;
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));
const { createEmployee } = await import("./employees/actions");
const { generatePayrollRun, advanceRunStatus, reverseFinalizedRun, getReversalOverpaid } = await import("./salary-sheet/actions");

let cashId: string;
let asha: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const person = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0];
const add = async (code: string, name: string) => {
  await createEmployee({
    employeeCode: code, fullName: name, address: "", contactNumber: "", email: "", panNumber: "", joiningDate: "2026-01-01", leavingDate: "",
    department: "", designation: "", employmentType: "full_time", employmentStatus: "active", bankName: "", bankAccountNumber: "", initialSalary: 30000,
  });
  return (await person(code)).id;
};
const pay = (paymentType: "staff_advance" | "salary_payment", employeeId: string, amount: number, date: string, month?: number) =>
  createPayment(org.tenantId, org.userId, "TMP", {
    direction: "money_out", paymentType, paymentDate: date, partyType: "employee", employeeId, accountId: cashId, paymentMethod: "cash", amount,
    ...(month ? { advanceMonth: { calendar: "AD" as const, month, year: 2026 } } : {}), confirmDuplicate: true,
  });
const overpaid = async () => Object.fromEntries((await overpaidStaff(org.tenantId)).map((p) => [p.employeeId, p.overpaid]));
const lineOf = async (runId: string) => (await db.select().from(payrollLines).where(eq(payrollLines.payrollRunId, runId)))[0];
const runRow = async (id: string) => (await db.select().from(payrollRuns).where(eq(payrollRuns.id, id)))[0];
const finalize = async (runId: string) => {
  await advanceRunStatus({ runId });
  await advanceRunStatus({ runId });
};

beforeAll(async () => {
  org = await createTempOrg("ZZ One Staff Account");
  dropCountry = await useCountryWithoutSlabs(org.tenantId, "ZQ");
  cashId = (await acct("1000")).id;
  asha = await add("A-1", "Asha");
});
afterAll(async () => {
  await org.remove();
  await dropCountry();
});

describe("one account for salary and advances", () => {
  let june: string;
  let july: string;
  let net = 0;

  it("does not call an advance waiting for its payroll month an overpayment", async () => {
    await pay("staff_advance", asha, 5000, "2026-06-05", 6);
    expect(await getStaffBalance(org.tenantId, asha)).toBe(-5000);
    expect(await overpaid()).toEqual({});
  });

  it("sets the advance off when payroll is finalized, then takes any salary payment, flagging what is beyond the pay", async () => {
    june = await generatePayrollRun({ month: 6, year: 2026, calendar: "AD", employeeIds: [asha] });
    net = Number((await lineOf(june)).netPay);
    await finalize(june);
    expect(await getStaffBalance(org.tenantId, asha)).toBe(net);
    await pay("salary_payment", asha, net + 3000, "2026-07-02");
    expect(await getStaffBalance(org.tenantId, asha)).toBe(-3000);
    expect(await overpaid()).toEqual({ [asha]: 3000 });
  });

  it("takes the overpayment off the next payslip, keeping the salary itself unchanged, and clears the warning", async () => {
    july = await generatePayrollRun({ month: 7, year: 2026, calendar: "AD", employeeIds: [asha] });
    const line = await lineOf(july);
    expect((await draftOverpaidAdjustments(org.tenantId, await runRow(july))).get(line.id)).toBe(3000);
    await finalize(july);
    const posted = await lineOf(july);
    expect(Number(posted.overpaidAdjusted)).toBe(3000);
    expect(await getStaffBalance(org.tenantId, asha)).toBe(Number(posted.netPay) - 3000);
    expect(await overpaid()).toEqual({});
  });

  it("says who would be overpaid before a reversal, and still allows it", async () => {
    await pay("salary_payment", asha, (await getStaffBalance(org.tenantId, asha)), "2026-08-02");
    const would = await getReversalOverpaid({ runId: july });
    expect(would).toHaveLength(1);
    expect(would[0].name).toBe("Asha");
    await reverseFinalizedRun({ runId: july, reason: "wrong" });
    expect(await overpaid()).toEqual({ [asha]: would[0].overpaid });
    expect(Number((await lineOf(july)).overpaidAdjusted)).toBe(0);
  });
});

describe("moving history from the old advance account", () => {
  let bimal: string;
  let oldAccount: string;
  let before = 0;

  beforeAll(async () => {
    bimal = await add("B-1", "Bimal");
    // As it was before: advances sat on the employee's own account under Staff Advances.
    const [group] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "1360", name: "Staff Advances", category: "asset", subCategory: "Current assets" }).returning();
    oldAccount = (await createSubAccount(org.tenantId, group, "Bimal")).id;
    await db.update(employees).set({ advanceAccountId: oldAccount }).where(eq(employees.id, bimal));
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-05-01", sourceType: "manual", memo: "Old advance", createdBy: org.userId, lines: [{ accountId: oldAccount, debitAmount: 4000 }, { accountId: cashId, creditAmount: 4000 }] });
    const salary = (await person("B-1")).payableAccountId!;
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-05-02", sourceType: "manual", memo: "Old salary owed", createdBy: org.userId, lines: [{ accountId: cashId, debitAmount: 10000 }, { accountId: salary, creditAmount: 10000 }] });
    before = await getStaffBalance(org.tenantId, bimal);
  });

  const linesOn = async (id: string) => (await db.select().from(journalLines).where(eq(journalLines.accountId, id))).length;

  it("already counts both accounts before anything is moved", () => {
    expect(before).toBe(6000);
  });

  it("previews without writing", async () => {
    const plan = await planStaffAccountMerge(org.tenantId);
    expect(plan.rows).toEqual([expect.objectContaining({ employeeId: bimal, salaryAccount: 10000, advanceAccount: -4000, combined: 6000, lines: 1 })]);
    expect(plan.totalsFallBy).toBe(4000);
    expect(await linesOn(oldAccount)).toBe(1);
  });

  it("moves the lines, keeps every balance, and lowers assets and liabilities by the same amount", async () => {
    const was = await balanceSheet(org.tenantId, new Date("2026-12-31T00:00:00Z"));
    await mergeStaffAccounts(org.tenantId);
    const now = await balanceSheet(org.tenantId, new Date("2026-12-31T00:00:00Z"));
    expect(await getStaffBalance(org.tenantId, bimal)).toBe(before);
    expect(await linesOn(oldAccount)).toBe(0);
    expect(Math.round((was.totalAssets - now.totalAssets) * 100) / 100).toBe(4000);
    expect(Math.round((was.totalLiabilities - now.totalLiabilities) * 100) / 100).toBe(4000);
    expect(now.isBalanced).toBe(was.isBalanced);
    expect((await db.select().from(accounts).where(eq(accounts.id, oldAccount)))[0].isActive).toBe(false);
    expect((await acct("2300")).name).toBe("Staff accounts");
    expect((await mergeStaffAccounts(org.tenantId)).lines).toBe(0); // safe to run again
  });

  it("can be undone", async () => {
    expect(await undoStaffAccountMerge(org.tenantId)).toBe(1);
    expect(await linesOn(oldAccount)).toBe(1);
    expect(await getStaffBalance(org.tenantId, bimal)).toBe(before);
    expect((await db.select().from(accounts).where(eq(accounts.id, oldAccount)))[0].isActive).toBe(true);
    expect((await db.select().from(staffAccountMoves).where(eq(staffAccountMoves.tenantId, org.tenantId))).length).toBe(0);
  });
});
