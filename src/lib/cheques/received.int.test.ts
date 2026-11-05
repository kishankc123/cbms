import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, payments, receivedCheques } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { todayIso } from "@/lib/calendar";
import { cashBalanceAsOf } from "@/lib/dashboard/cash-flow";
import { chequeBankAccounts } from "./cheques";
import { clearReceived, closeReceived, depositReceived, receiveCheque, type ReceivedInput } from "./received";

// A cheque from a customer is a register entry until the bank pays it. Only then is a receipt posted, through the normal payment engine.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let bankId: string;
let customerId: string;
const today = todayIso();
const later = new Date(Date.parse(today + "T00:00:00Z") + 20 * 86_400_000).toISOString().slice(0, 10);
const balance = () => cashBalanceAsOf(org.tenantId, [bankId], today);
const input = (over: Partial<ReceivedInput> = {}): ReceivedInput => ({ customerId, drawerBank: "Nabil Bank", chequeNumber: "778801", amount: 12000, receivedDate: today, chequeDate: today, memo: null, ...over });
const status = async (id: string) => (await db.select().from(receivedCheques).where(eq(receivedCheques.id, id)))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Received Cheques");
  bankId = (await chequeBankAccounts(org.tenantId))[0].id;
  const [c] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Cheque Customer" }).returning();
  customerId = c.id;
});
afterAll(async () => {
  await db.delete(receivedCheques).where(eq(receivedCheques.tenantId, org.tenantId));
  await org.remove();
});

describe("received cheques", () => {
  it("records a post-dated cheque without touching the books, and not twice", async () => {
    const before = await balance();
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778801", chequeDate: later }), today);
    expect(await status(id)).toMatchObject({ status: "received", payerName: "Cheque Customer", paymentId: null });
    expect(await balance()).toBe(before);
    await expect(receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778801", chequeDate: later }), today)).rejects.toThrow(/already in the register/);
  });

  it("will not deposit or clear before the date on the cheque", async () => {
    const [row] = await db.select().from(receivedCheques).where(eq(receivedCheques.tenantId, org.tenantId));
    await expect(depositReceived(org.tenantId, row.id, bankId, today, today)).rejects.toThrow(/before the date written on it/);
    await expect(clearReceived(org.tenantId, org.userId, row.id, bankId, today, today)).rejects.toThrow(/before the date written on it/);
  });

  it("deposits, then posts the receipt when it clears, once", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778802", amount: 9000 }), today);
    await depositReceived(org.tenantId, id, bankId, today, today);
    expect(await status(id)).toMatchObject({ status: "deposited", depositAccountId: bankId });
    const before = await balance();
    const r = await clearReceived(org.tenantId, org.userId, id, null, today, today);
    expect(r.paymentId).toBeTruthy();
    expect(await balance()).toBe(before + 9000);
    const [pay] = await db.select().from(payments).where(eq(payments.id, r.paymentId!));
    expect(pay).toMatchObject({ direction: "money_in", paymentType: "customer_payment", paymentMethod: "cheque", chequeNumber: "778802", chequeBank: "Nabil Bank", status: "posted" });
    expect(await status(id)).toMatchObject({ status: "cleared", paymentId: r.paymentId });
    await expect(clearReceived(org.tenantId, org.userId, id, null, today, today)).rejects.toThrow(/not waiting to clear/);
  });

  it("clears a held cheque straight into a chosen account", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778803", amount: 3000 }), today);
    await expect(clearReceived(org.tenantId, org.userId, id, null, today, today)).rejects.toThrow(/Choose the bank account/);
    const before = await balance();
    await clearReceived(org.tenantId, org.userId, id, bankId, today, today);
    expect(await balance()).toBe(before + 3000);
    expect(await status(id)).toMatchObject({ status: "cleared", depositAccountId: bankId, depositedDate: today });
  });

  it("gives a held cheque back to the customer with a reason, changing nothing in the books", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778804", chequeDate: later }), today);
    const before = await balance();
    await expect(closeReceived(org.tenantId, org.userId, id, "returned", " ")).rejects.toThrow(/reason/);
    await closeReceived(org.tenantId, org.userId, id, "returned", "Customer asked for it back");
    expect(await balance()).toBe(before);
    expect(await status(id)).toMatchObject({ status: "returned", closedReason: "Customer asked for it back" });
    await expect(closeReceived(org.tenantId, org.userId, id, "returned", "again")).rejects.toThrow(/still holding/);
  });

  it("marks a deposited cheque bounced without touching the books", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778805", amount: 5000 }), today);
    await depositReceived(org.tenantId, id, bankId, today, today);
    const before = await balance();
    await closeReceived(org.tenantId, org.userId, id, "bounced", "Insufficient funds");
    expect(await balance()).toBe(before);
    expect((await status(id)).status).toBe("bounced");
  });

  it("takes the receipt back when the bank returns a cheque that had cleared", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778806", amount: 7000 }), today);
    const r = await clearReceived(org.tenantId, org.userId, id, bankId, today, today);
    const before = await balance();
    await closeReceived(org.tenantId, org.userId, id, "bounced", "Account closed");
    expect(await balance()).toBe(before - 7000);
    expect((await db.select().from(payments).where(eq(payments.id, r.paymentId!)))[0].status).toBe("voided");
    expect((await status(id)).status).toBe("bounced");
  });

  it("only lets a held cheque be given back, and only a deposited one bounce", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, input({ chequeNumber: "778807" }), today);
    await expect(closeReceived(org.tenantId, org.userId, id, "bounced", "Not yet deposited")).rejects.toThrow(/was deposited/);
  });
});
