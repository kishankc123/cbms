import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, cashReconciliationLines, cashReconciliations, customers, journalEntries, journalLines, payments } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, updatePayment, voidPayment, type UpdatePaymentInput } from "./payments-engine";
import { getOrCreateCustomerReceivableAccountId } from "./subledger-accounts";
import { getCustomerLines } from "./customer-balances";
import { buildStatement } from "./party-ledger";
import { reconciledEntryIds } from "./reconciled-entries";

// A payment that has been reconciled keeps its date, amount and payment account; the party, category, reference, description and notes can still change.
// Moving it to another party is a small entry that touches only the two parties' accounts, never the reconciled cash line, and it is taken back with the payment.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let custA: string;
let custB: string;
let paymentId: string;
let entryId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const baseOf = (over: Partial<UpdatePaymentInput> = {}): UpdatePaymentInput => ({ paymentDate: "2026-09-05", partyType: "customer", customerId: custA, accountId: cashId, paymentMethod: "cash", amount: 500, ...over });
const edit = (over: Partial<UpdatePaymentInput>) => updatePayment(org.tenantId, org.userId, paymentId, baseOf(over));
const balanceOf = async (customerId: string) => buildStatement((await getCustomerLines(org.tenantId)).get(customerId) ?? [], "debit").closingBalance;
const cashLines = async () => (await db.select().from(journalLines).where(eq(journalLines.accountId, cashId))).filter((l) => Number(l.debitAmount) !== 0 || Number(l.creditAmount) !== 0);
const row = async () => (await db.select().from(payments).where(eq(payments.id, paymentId)))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Reconciled Edit");
  cashId = (await acct("1000")).id;
  const [a] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer A" }).returning();
  const [b] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer B" }).returning();
  custA = a.id;
  custB = b.id;
  await getOrCreateCustomerReceivableAccountId(org.tenantId, custA);
  await getOrCreateCustomerReceivableAccountId(org.tenantId, custB);
  const made = await createPayment(org.tenantId, org.userId, "TMP-R1", { direction: "money_in", paymentType: "customer_payment", paymentDate: "2026-09-05", partyType: "customer", customerId: custA, accountId: cashId, paymentMethod: "cash", amount: 500, confirmDuplicate: true } as never);
  paymentId = (made as { paymentId: string }).paymentId;
  entryId = (await row()).journalEntryId!;
  // tick it in a cash reconciliation
  const [bank] = await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: cashId }).returning();
  const [recon] = await db
    .insert(cashReconciliations)
    .values({ tenantId: org.tenantId, bankAccountId: bank.id, accountId: cashId, asOfDate: "2026-09-30", throughDate: "2026-09-30", opening: "0", closing: "500", status: "reconciled" })
    .returning();
  const [cashLine] = (await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entryId))).filter((l) => l.accountId === cashId);
  await db.insert(cashReconciliationLines).values({ tenantId: org.tenantId, reconId: recon.id, journalLineId: cashLine.id });
});
afterAll(async () => {
  await org.remove();
});

describe("editing a payment that has been reconciled", () => {
  it("is reconciled, and refuses a change to the date, amount or payment account", async () => {
    expect((await reconciledEntryIds(org.tenantId, [entryId])).has(entryId)).toBe(true);
    await expect(edit({ paymentDate: "2026-09-04" })).rejects.toThrow(/reconciled, so its date/);
    await expect(edit({ amount: 600 })).rejects.toThrow(/amount/);
    const bank = (await acct("1010")).id;
    await expect(edit({ accountId: bank })).rejects.toThrow(/payment account/);
    expect((await cashLines()).length).toBe(1);
  });

  it("changes the description, reference and notes without touching the books", async () => {
    const entries = (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
    const r = await edit({ description: "Rent for September", referenceNumber: "REF-9", notes: "checked" });
    expect(r.changed).toBe(true);
    expect((await row()).description).toBe("Rent for September");
    expect((await row()).referenceNumber).toBe("REF-9");
    expect((await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length).toBe(entries);
  });

  it("needs a reason to move it to another customer, then moves only the two customers' accounts", async () => {
    await expect(edit({ customerId: custB })).rejects.toThrow(/Say why/);
    expect(await balanceOf(custA)).toBe(-500);
    await edit({ customerId: custB, reason: "Entered under the wrong customer" });
    expect((await row()).customerId).toBe(custB);
    expect(await balanceOf(custA)).toBe(0);
    expect(await balanceOf(custB)).toBe(-500);
    // the reconciled cash line is untouched: still one line, the original entry still active
    expect((await cashLines()).length).toBe(1);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.id, entryId)))[0].isReversed).toBe(false);
    expect((await row()).journalEntryId).toBe(entryId);
  });

  it("moving it again moves it from where it is now", async () => {
    await edit({ customerId: custA, reason: "Back to the first customer" });
    expect(await balanceOf(custA)).toBe(-500);
    expect(await balanceOf(custB)).toBe(0);
  });

  it("is still refused a void while reconciled", async () => {
    await expect(voidPayment(org.tenantId, paymentId, org.userId, "test")).rejects.toThrow();
  });

  it("takes the move back with the payment when it is voided after the reconciliation is reopened", async () => {
    await edit({ customerId: custB, reason: "Moved again" });
    expect(await balanceOf(custB)).toBe(-500);
    await db.update(cashReconciliations).set({ status: "reopened" }).where(eq(cashReconciliations.tenantId, org.tenantId));
    await voidPayment(org.tenantId, paymentId, org.userId, "test");
    expect((await row()).status).toBe("voided");
    expect(await balanceOf(custA)).toBe(0);
    expect(await balanceOf(custB)).toBe(0);
  });
});
