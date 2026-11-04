import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, issuedCheques, payments, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { todayIso } from "@/lib/calendar";
import { chequeBankAccounts, clearCheque, closeCheque, issueCheque, nextNumberFor, type ChequeInput } from "./cheques";
import { cashBalanceAsOf } from "@/lib/dashboard/cash-flow";

// A cheque is a register entry until the bank pays it. Only then is a payment posted, through the normal payment engine.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let bankId: string;
let vendorId: string;
const today = todayIso();
const later = new Date(Date.parse(today + "T00:00:00Z") + 20 * 86_400_000).toISOString().slice(0, 10);
const balance = () => cashBalanceAsOf(org.tenantId, [bankId], today);
const input = (over: Partial<ChequeInput> = {}): ChequeInput => ({ bankAccountId: bankId, chequeNumber: "004510", payeeKind: "supplier", vendorId, expenseId: null, amount: 8000, issueDate: today, chequeDate: today, memo: null, replacesId: null, ...over });

beforeAll(async () => {
  org = await createTempOrg("ZZ Cheques");
  bankId = (await chequeBankAccounts(org.tenantId))[0].id;
  const [v] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Cheque Supplier" }).returning();
  vendorId = v.id;
  const [equity] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "3000")));
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: bankId, debitAmount: 50000 }, { accountId: equity.id, creditAmount: 50000 }] });
});
afterAll(async () => {
  await db.delete(issuedCheques).where(eq(issuedCheques.tenantId, org.tenantId));
  await org.remove();
});

describe("issued cheques", () => {
  it("writes a post-dated cheque down without touching the books", async () => {
    const before = await balance();
    const { id } = await issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004510", chequeDate: later }), today);
    const [row] = await db.select().from(issuedCheques).where(eq(issuedCheques.id, id));
    expect(row).toMatchObject({ status: "issued", payeeName: "Cheque Supplier", paymentId: null });
    expect(await balance()).toBe(before);
    expect(await db.select().from(payments).where(eq(payments.tenantId, org.tenantId))).toHaveLength(0);
  });

  it("uses a cheque number once, and suggests the next one", async () => {
    await expect(issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004510" }), today)).rejects.toThrow(/already been used/);
    expect(await nextNumberFor(org.tenantId, bankId)).toBe("004511");
  });

  it("will not clear before the date on the cheque", async () => {
    const [row] = await db.select().from(issuedCheques).where(eq(issuedCheques.tenantId, org.tenantId));
    await expect(clearCheque(org.tenantId, org.userId, row.id, today, today)).rejects.toThrow(/before the date written on it/);
  });

  it("posts the payment when it clears, once", async () => {
    const { id } = await issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004511", amount: 8000 }), today);
    const before = await balance();
    const r = await clearCheque(org.tenantId, org.userId, id, today, today);
    expect(r.paymentId).toBeTruthy();
    expect(await balance()).toBe(before - 8000);
    const [row] = await db.select().from(issuedCheques).where(eq(issuedCheques.id, id));
    expect(row).toMatchObject({ status: "cleared", clearedDate: today, paymentId: r.paymentId });
    const [pay] = await db.select().from(payments).where(eq(payments.id, r.paymentId!));
    expect(pay).toMatchObject({ paymentType: "supplier_payment", paymentMethod: "cheque", chequeNumber: "004511", status: "posted" });
    await expect(clearCheque(org.tenantId, org.userId, id, today, today)).rejects.toThrow(/not waiting to clear/);
  });

  it("stops a cheque that never cleared, with a reason and no effect on the books", async () => {
    const { id } = await issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004512", chequeDate: later }), today);
    const before = await balance();
    await expect(closeCheque(org.tenantId, org.userId, id, "stopped", " ")).rejects.toThrow(/reason/);
    await closeCheque(org.tenantId, org.userId, id, "stopped", "Lost in transit");
    expect(await balance()).toBe(before);
    const [row] = await db.select().from(issuedCheques).where(eq(issuedCheques.id, id));
    expect(row).toMatchObject({ status: "stopped", closedReason: "Lost in transit" });
  });

  it("takes the payment back when the bank returns a cheque that had cleared", async () => {
    const { id } = await issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004513", amount: 3000 }), today);
    const r = await clearCheque(org.tenantId, org.userId, id, today, today);
    const before = await balance();
    await closeCheque(org.tenantId, org.userId, id, "bounced", "Returned: signature mismatch");
    expect(await balance()).toBe(before + 3000);
    const [pay] = await db.select().from(payments).where(eq(payments.id, r.paymentId!));
    expect(pay.status).toBe("voided");
    const [row] = await db.select().from(issuedCheques).where(eq(issuedCheques.id, id));
    expect(row.status).toBe("bounced");
  });

  it("lets a stopped cheque be replaced, and nothing else", async () => {
    const [stopped] = await db.select().from(issuedCheques).where(and(eq(issuedCheques.tenantId, org.tenantId), eq(issuedCheques.status, "stopped")));
    const { id } = await issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004514", replacesId: stopped.id }), today);
    expect(id).toBeTruthy();
    const [cleared] = await db.select().from(issuedCheques).where(and(eq(issuedCheques.tenantId, org.tenantId), eq(issuedCheques.status, "cleared")));
    await expect(issueCheque(org.tenantId, org.userId, input({ chequeNumber: "004515", replacesId: cleared.id }), today)).rejects.toThrow(/Only a bounced or stopped cheque/);
  });
});
