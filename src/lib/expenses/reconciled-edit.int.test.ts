import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, cashReconciliationLines, cashReconciliations, expenses, journalEntries, journalLines, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createExpenseCore } from "./expense-records";
import { changeReconciledExpense, isExpenseReconciled, storedExpensePayments } from "./reconciled-edit";
import { voidExpenseCore } from "./void-expense";
import { getSupplierBalances } from "@/lib/ledger/supplier-balances";

// An expense that has been reconciled keeps its date, amounts and payment accounts; its category, supplier and details can still change. Moving the category or
// supplier is a small entry that touches only those accounts, never the reconciled cash line, and it is taken back with the expense.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let cleaningId: string;
let securityId: string;
let supA: string;
let supB: string;
let reconId: string | null = null;
let bankAccountId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const balanceOf = async (accountId: string) => {
  const lines = await db.select().from(journalLines).where(eq(journalLines.accountId, accountId));
  return Math.round(lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0) * 100) / 100;
};
const row = async (id: string) => (await db.select().from(expenses).where(eq(expenses.id, id)))[0];
const input = (over: Record<string, unknown> = {}) => ({
  expenseDate: "2026-09-01",
  categoryAccountId: cleaningId,
  vendorId: null as string | null,
  description: "Cleaning",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  billType: "no_bill" as const,
  taxTreatment: "taxable" as const,
  taxableAmount: 1000,
  vatAmount: 0,
  tdsAmount: 0,
  otherTaxAmount: 0,
  payments: [{ accountId: cashId, amount: 1000 }],
  ...over,
});
const edit = (expenseId: string, over: Record<string, unknown> = {}) =>
  changeReconciledExpense(org.tenantId, org.userId, { expenseId, categoryAccountId: cleaningId, vendorId: null, description: "Cleaning", invoiceNumber: "", invoiceDate: "", dueDate: "", ...over });
// ticks the expense's cash line in a cash reconciliation (made the first time it is needed: once it exists, earlier dates are closed)
async function reconcile(expenseId: string) {
  if (!reconId) {
    const [recon] = await db.insert(cashReconciliations).values({ tenantId: org.tenantId, bankAccountId, accountId: cashId, asOfDate: "2026-09-30", throughDate: "2026-09-30", opening: "0", closing: "0", status: "reconciled" }).returning();
    reconId = recon.id;
  }
  const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, expenseId), eq(journalEntries.isReversed, false)));
  const cashLine = (await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entries[0].id))).find((l) => l.accountId === cashId)!;
  await db.insert(cashReconciliationLines).values({ tenantId: org.tenantId, reconId, journalLineId: cashLine.id });
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Reconciled Expense");
  cashId = (await acct("1000")).id;
  cleaningId = (await acct("5320")).id;
  securityId = (await acct("5330")).id;
  supA = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier A" }).returning())[0].id;
  supB = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier B" }).returning())[0].id;
  bankAccountId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: cashId }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("an expense that has been reconciled", () => {
  let id: string;

  it("is edited in full until it is reconciled", async () => {
    id = (await createExpenseCore({ tenantId: org.tenantId, userId: org.userId }, input())).expenseId;
    expect(await isExpenseReconciled(org.tenantId, id)).toBe(false);
    await expect(edit(id)).rejects.toThrow(/not been reconciled/);
    await reconcile(id);
    expect(await isExpenseReconciled(org.tenantId, id)).toBe(true);
  });

  it("changes the description and invoice details without touching the books", async () => {
    const before = (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
    const r = await edit(id, { description: "Monthly cleaning", invoiceNumber: "INV-7" });
    expect(r.changed).toBe(true);
    expect((await row(id)).description).toBe("Monthly cleaning");
    expect((await row(id)).invoiceNumber).toBe("INV-7");
    expect((await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length).toBe(before);
    expect((await edit(id, { description: "Monthly cleaning", invoiceNumber: "INV-7" })).changed).toBe(false);
  });

  it("needs a reason to move to another category, then moves only the two categories", async () => {
    await expect(edit(id, { categoryAccountId: securityId })).rejects.toThrow(/Say why/);
    expect(await balanceOf(cleaningId)).toBe(1000);
    await edit(id, { categoryAccountId: securityId, description: "Monthly cleaning", invoiceNumber: "INV-7", reason: "Booked to the wrong category" });
    expect((await row(id)).categoryAccountId).toBe(securityId);
    expect(await balanceOf(cleaningId)).toBe(0);
    expect(await balanceOf(securityId)).toBe(1000);
    // the reconciled cash line is untouched, and still reads back as the one payment
    expect(await balanceOf(cashId)).toBe(-1000);
    expect(await storedExpensePayments(org.tenantId, await row(id))).toEqual([{ accountId: cashId, amount: 1000, modeId: null }]);
  });

  it("moves the unpaid part to another supplier, and leaves the paid part where it was", async () => {
    const partly = (await createExpenseCore({ tenantId: org.tenantId, userId: org.userId }, input({ expenseDate: "2026-10-05", vendorId: supA, payments: [{ accountId: cashId, amount: 400 }], description: "Part paid" }))).expenseId;
    await reconcile(partly);
    expect((await getSupplierBalances(org.tenantId))[supA]).toBe(600);
    await expect(edit(partly, { vendorId: supB, description: "Part paid" })).rejects.toThrow(/Say why/);
    await edit(partly, { vendorId: supB, description: "Part paid", reason: "Wrong supplier" });
    const balances = await getSupplierBalances(org.tenantId);
    expect(balances[supA]).toBe(0);
    expect(balances[supB]).toBe(600);
    expect((await row(partly)).vendorId).toBe(supB);
    expect(await balanceOf(cashId)).toBe(-1400);
  });

  it("is still refused a void while reconciled, and the moves go with it once it can be voided", async () => {
    await expect(voidExpenseCore(org.tenantId, org.userId, id)).rejects.toThrow();
    await db.update(cashReconciliations).set({ status: "reopened" }).where(eq(cashReconciliations.id, reconId!));
    await voidExpenseCore(org.tenantId, org.userId, id);
    expect(await balanceOf(securityId)).toBe(0);
    // what is left in Cleaning is only the other expense of this test, the part-paid one
    expect(await balanceOf(cleaningId)).toBe(1000);
  });
});
