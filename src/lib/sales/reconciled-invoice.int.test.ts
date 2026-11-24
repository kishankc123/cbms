import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, cashReconciliationLines, cashReconciliations, customers, journalEntries, journalLines, payments, salesInvoices } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getCustomerLines } from "@/lib/ledger/customer-balances";
import { buildStatement } from "@/lib/ledger/party-ledger";

// A sales invoice that has been reconciled keeps its date, items, totals and payments; the customer, revenue account, invoice number and due date can still
// change. Moving the customer or revenue account is a small voucher that touches only those accounts, and it is taken back with the invoice.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let org: Awaited<ReturnType<typeof createTempOrg>>;
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));
const { createSingleInvoice, updateReconciledSalesInvoice, getSalesInvoiceForEdit, voidInvoice } = await import("@/app/(app)/sales/actions");

let cashId: string;
let revenueId: string;
let otherIncomeId: string;
let custA: string;
let custB: string;
let invoiceId: string;
let reconId: string | null = null;
let bankAccountId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const balanceOf = async (accountId: string) => {
  const lines = await db.select().from(journalLines).where(eq(journalLines.accountId, accountId));
  return Math.round(lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0) * 100) / 100;
};
const row = async () => (await db.select().from(salesInvoices).where(eq(salesInvoices.id, invoiceId)))[0];
const edit = (over: Record<string, unknown> = {}) => updateReconciledSalesInvoice({ invoiceId, customerId: custA, invoiceNumber: "S-1", dueDate: null, revenueAccountId: null, ...over });
const statementOf = async (customerId: string) => buildStatement((await getCustomerLines(org.tenantId)).get(customerId) ?? [], "debit");

beforeAll(async () => {
  org = await createTempOrg("ZZ Reconciled Invoice");
  cashId = (await acct("1000")).id;
  revenueId = (await acct("4000")).id;
  otherIncomeId = (await acct("4100")).id;
  custA = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer A" }).returning())[0].id;
  custB = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer B" }).returning())[0].id;
  bankAccountId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: cashId }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("a sales invoice that has been reconciled", () => {
  it("is edited in full until its payment is reconciled", async () => {
    await createSingleInvoice({ invoiceNumber: "S-1", invoiceDate: "2026-09-01", customerId: custA, lines: [{ itemId: null, description: "Service", rate: 1000, quantity: 1, discount: 0 }], payments: [{ accountId: cashId, amount: 1000 }] });
    invoiceId = (await db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, org.tenantId)))[0].id;
    expect((await getSalesInvoiceForEdit(invoiceId)).reconciled).toBe(false);
    await expect(edit()).rejects.toThrow(/not been reconciled/);

    // tick the payment's cash line in a cash reconciliation
    const [recon] = await db.insert(cashReconciliations).values({ tenantId: org.tenantId, bankAccountId, accountId: cashId, asOfDate: "2026-09-30", throughDate: "2026-09-30", opening: "0", closing: "0", status: "reconciled" }).returning();
    reconId = recon.id;
    const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, invoiceId), eq(journalEntries.sourceType, "receipt")));
    const cashLine = (await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entries[0].id))).find((l) => l.accountId === cashId)!;
    await db.insert(cashReconciliationLines).values({ tenantId: org.tenantId, reconId: recon.id, journalLineId: cashLine.id });
    expect((await getSalesInvoiceForEdit(invoiceId)).reconciled).toBe(true);
  });

  it("changes the invoice number and due date without touching the books", async () => {
    const before = (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
    expect((await edit({ invoiceNumber: "S-1A", dueDate: "2026-09-30" })).changed).toBe(true);
    expect((await row()).invoiceNumber).toBe("S-1A");
    expect((await row()).dueDate).toBe("2026-09-30");
    expect((await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length).toBe(before);
  });

  it("needs a reason to move it to another customer, then moves the invoice and its payment to them", async () => {
    await expect(edit({ invoiceNumber: "S-1A", customerId: custB })).rejects.toThrow(/Say why/);
    await edit({ invoiceNumber: "S-1A", customerId: custB, reason: "Sold to the wrong customer" });
    expect((await row()).customerId).toBe(custB);
    // paid in full, so both owe nothing; the history sits with the new customer
    expect((await statementOf(custA)).closingBalance).toBe(0);
    expect((await statementOf(custB)).closingBalance).toBe(0);
    expect((await statementOf(custB)).rows.length).toBeGreaterThan(0);
    // the payment recorded with the invoice follows it
    const paymentRows = await db.select().from(payments).where(eq(payments.tenantId, org.tenantId));
    expect(paymentRows.every((p) => p.customerId === custB)).toBe(true);
    // the reconciled cash line is untouched
    expect(await balanceOf(cashId)).toBe(1000);
  });

  it("moves the revenue to another account, and only that", async () => {
    expect(await balanceOf(revenueId)).toBe(-1000);
    await expect(edit({ invoiceNumber: "S-1A", customerId: custB, revenueAccountId: otherIncomeId })).rejects.toThrow(/Say why/);
    await edit({ invoiceNumber: "S-1A", customerId: custB, revenueAccountId: otherIncomeId, reason: "Wrong revenue account" });
    expect(await balanceOf(revenueId)).toBe(0);
    expect(await balanceOf(otherIncomeId)).toBe(-1000);
    expect((await row()).revenueAccountId).toBe(otherIncomeId);
    expect(await balanceOf(cashId)).toBe(1000);
  });

  it("takes every change back with the invoice when it is voided after the reconciliation is reopened", async () => {
    await db.update(cashReconciliations).set({ status: "reopened" }).where(eq(cashReconciliations.id, reconId!));
    const form = new FormData();
    form.append("invoiceId", invoiceId);
    await voidInvoice(form);
    expect((await row()).status).toBe("void");
    expect(await balanceOf(revenueId)).toBe(0);
    expect(await balanceOf(otherIncomeId)).toBe(0);
    expect(await balanceOf(cashId)).toBe(0);
    expect((await statementOf(custA)).closingBalance).toBe(0);
    expect((await statementOf(custB)).closingBalance).toBe(0);
  });
});
