import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, cashReconciliationLines, cashReconciliations, employees, journalEntries, journalLines, staffAdvances } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { useCountryWithoutSlabs } from "@/test/no-slabs-country";
import { createPayment, updatePayment, type UpdatePaymentInput } from "@/lib/ledger/payments-engine";
import { getEmployeeAdvanceOutstanding } from "@/lib/payroll/staff-advances";
import { getEmployeeAdvanceBalance } from "@/lib/ledger/advance-accounts";

// Changing a staff advance payment to another employee must move the advance in the Payroll > Advances list as well as in the books, whether the payment was
// edited in full or after it had been reconciled.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let org: Awaited<ReturnType<typeof createTempOrg>>;
let dropCountry: () => Promise<void>;
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));
const { createEmployee } = await import("./employees/actions");

let cashId: string;
let chandra: string;
let bimal: string;
let paymentId: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const empInput = (code: string, name: string) => ({
  employeeCode: code, fullName: name, address: "", contactNumber: "", email: "", panNumber: "", joiningDate: "2026-01-01", leavingDate: "",
  department: "", designation: "", employmentType: "full_time" as const, employmentStatus: "active" as const, bankName: "", bankAccountNumber: "", initialSalary: 30000,
});
const employee = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0].id;
const advanceRow = async () => (await db.select().from(staffAdvances).where(eq(staffAdvances.paymentId, paymentId)))[0];
const edit = (employeeId: string, reason?: string) =>
  updatePayment(org.tenantId, org.userId, paymentId, {
    paymentDate: "2026-09-05", partyType: "employee", employeeId, accountId: cashId, paymentMethod: "cash", amount: 5000, advanceMonth: { calendar: "AD", month: 9, year: 2026 }, ...(reason ? { reason } : {}),
  } as UpdatePaymentInput);
const consistent = async (employeeId: string) => expect(await getEmployeeAdvanceBalance(org.tenantId, employeeId)).toBe(await getEmployeeAdvanceOutstanding(org.tenantId, employeeId));

beforeAll(async () => {
  org = await createTempOrg("ZZ Advance Employee");
  dropCountry = await useCountryWithoutSlabs(org.tenantId, "ZQ");
  cashId = (await acct("1000")).id;
  await createEmployee(empInput("A-1", "Chandra"));
  await createEmployee(empInput("A-2", "Bimal"));
  chandra = await employee("A-1");
  bimal = await employee("A-2");
  const made = await createPayment(org.tenantId, org.userId, "TMP-SA", {
    direction: "money_out", paymentType: "staff_advance", paymentDate: "2026-09-05", partyType: "employee", employeeId: chandra, accountId: cashId, paymentMethod: "cash", amount: 5000,
    advanceMonth: { calendar: "AD", month: 9, year: 2026 }, confirmDuplicate: true,
  });
  paymentId = (made as { paymentId: string }).paymentId;
});
afterAll(async () => {
  await org.remove();
  await dropCountry();
});

describe("a staff advance moved to another employee", () => {
  it("moves in the advances list when the payment is edited in full", async () => {
    expect((await advanceRow()).employeeId).toBe(chandra);
    await edit(bimal);
    expect((await advanceRow()).employeeId).toBe(bimal);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(0);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, bimal)).toBe(5000);
    await consistent(chandra);
    await consistent(bimal);
  });

  it("moves in the advances list when the payment has been reconciled", async () => {
    const [bank] = await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: cashId }).returning();
    const [recon] = await db.insert(cashReconciliations).values({ tenantId: org.tenantId, bankAccountId: bank.id, accountId: cashId, asOfDate: "2026-09-30", throughDate: "2026-09-30", opening: "0", closing: "0", status: "reconciled" }).returning();
    const payment = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.isReversed, false)));
    const entry = payment.find((e) => e.sourceType === "payment" && !e.reversalOfId)!;
    const cashLine = (await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id))).find((l) => l.accountId === cashId)!;
    await db.insert(cashReconciliationLines).values({ tenantId: org.tenantId, reconId: recon.id, journalLineId: cashLine.id });

    await expect(edit(chandra)).rejects.toThrow(/Say why/);
    await edit(chandra, "Advance was for Chandra");
    expect((await advanceRow()).employeeId).toBe(chandra);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, bimal)).toBe(0);
    expect(await getEmployeeAdvanceOutstanding(org.tenantId, chandra)).toBe(5000);
    await consistent(chandra);
    await consistent(bimal);
  });
});
