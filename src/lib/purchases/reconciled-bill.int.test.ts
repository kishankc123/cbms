import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, cashReconciliationLines, cashReconciliations, journalEntries, journalLines, payments, purchaseBills, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount, findControlAccount } from "@/lib/ledger/control-accounts";
import { getSupplierBalances } from "@/lib/ledger/supplier-balances";
import { createCashPurchaseCore } from "./cash-purchase";

// A purchase bill that has been reconciled keeps its date, lines, totals and payments; the supplier, bill number, due date and bill in hand can still change.
// Moving the supplier moves what is still owed from one supplier's account to the other's, as a small voucher, and it is taken back with the bill.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let org: Awaited<ReturnType<typeof createTempOrg>>;
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));
const { updateReconciledPurchaseBill, getCashPurchaseForEdit, voidBill } = await import("@/app/(app)/purchases/actions");

let cashId: string;
let categoryId: string;
let supA: string;
let supB: string;
let billId: string;
let reconId: string | null = null;
let bankAccountId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const balanceOf = async (accountId: string) => {
  const lines = await db.select().from(journalLines).where(eq(journalLines.accountId, accountId));
  return Math.round(lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0) * 100) / 100;
};
const row = async () => (await db.select().from(purchaseBills).where(eq(purchaseBills.id, billId)))[0];
const edit = (over: Record<string, unknown> = {}) => updateReconciledPurchaseBill({ billId, vendorId: supA, billNumber: "B-1", ...over });

beforeAll(async () => {
  org = await createTempOrg("ZZ Reconciled Bill");
  cashId = (await acct("1000")).id;
  const cogs = (await findControlAccount(org.tenantId, ["5000"], "Cost of Goods Sold"))!;
  categoryId = (await createSubAccount(org.tenantId, cogs, "Bar items")).id;
  supA = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier A" }).returning())[0].id;
  supB = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier B" }).returning())[0].id;
  bankAccountId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: cashId }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("a purchase bill that has been reconciled", () => {
  it("is edited in full until its payment is reconciled", async () => {
    // 1,000 bought, 400 paid in cash, 600 still owed to Supplier A
    const made = await createCashPurchaseCore({ tenantId: org.tenantId, userId: org.userId }, { billNumber: "B-1", billDate: "2026-09-01", vendorId: supA, billType: "no_bill", billAvailable: true, lines: [{ description: "Beer", categoryId, rate: 1000, quantity: 1, discount: 0 }], payments: [{ accountId: cashId, amount: 400 }] });
    billId = made.billId;
    expect((await getCashPurchaseForEdit(billId)).reconciled).toBe(false);
    await expect(edit()).rejects.toThrow(/not been reconciled/);

    const [recon] = await db.insert(cashReconciliations).values({ tenantId: org.tenantId, bankAccountId, accountId: cashId, asOfDate: "2026-09-30", throughDate: "2026-09-30", opening: "0", closing: "0", status: "reconciled" }).returning();
    reconId = recon.id;
    const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, billId), eq(journalEntries.isReversed, false)));
    const cashLine = (await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entries[0].id))).find((l) => l.accountId === cashId)!;
    await db.insert(cashReconciliationLines).values({ tenantId: org.tenantId, reconId: recon.id, journalLineId: cashLine.id });
    expect((await getCashPurchaseForEdit(billId)).reconciled).toBe(true);
    expect((await getSupplierBalances(org.tenantId))[supA]).toBe(600);
  });

  it("changes the bill number and whether the bill is in hand without touching the books", async () => {
    const before = (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
    expect((await edit({ billNumber: "B-1A", billAvailable: false })).changed).toBe(true);
    expect((await row()).billNumber).toBe("B-1A");
    expect((await row()).billAvailable).toBe(false);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length).toBe(before);
  });

  it("needs a reason to move it to another supplier, then moves only what is still owed", async () => {
    await expect(edit({ billNumber: "B-1A", vendorId: supB })).rejects.toThrow(/Say why/);
    await edit({ billNumber: "B-1A", vendorId: supB, reason: "Bought from the other supplier" });
    const balances = await getSupplierBalances(org.tenantId);
    expect(balances[supA]).toBe(0);
    expect(balances[supB]).toBe(600);
    expect((await row()).vendorId).toBe(supB);
    // the payment taken with the bill follows it, and the reconciled cash line is untouched
    const paymentRows = await db.select().from(payments).where(eq(payments.tenantId, org.tenantId));
    expect(paymentRows.every((p) => p.vendorId === supB)).toBe(true);
    expect(await balanceOf(cashId)).toBe(-400);
    // reading the bill back still shows its one payment (the unpaid part on the former supplier's account is not one)
    expect((await getCashPurchaseForEdit(billId)).payments).toEqual([{ accountId: cashId, amount: 400, modeId: null }]);
  });

  it("takes the move back with the bill when it is voided after the reconciliation is reopened", async () => {
    await db.update(cashReconciliations).set({ status: "reopened" }).where(eq(cashReconciliations.id, reconId!));
    const form = new FormData();
    form.append("billId", billId);
    await voidBill(form);
    expect((await row()).status).toBe("void");
    const balances = await getSupplierBalances(org.tenantId);
    expect(balances[supA]).toBe(0);
    expect(balances[supB]).toBe(0);
    expect(await balanceOf(cashId)).toBe(0);
  });
});
