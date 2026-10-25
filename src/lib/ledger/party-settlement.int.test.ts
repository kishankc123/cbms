import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, paymentAllocations, payments, purchaseBills, salesInvoices, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "./post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { resettleParty } from "./party-settlement";
import { settleAllFromLedger } from "./legacy-advances";
import { insertEmbeddedCustomerPayment } from "@/lib/sales/invoice-records";
import { getCustomerAdvanceBalance, getOrCreateCustomerAdvanceAccountId, getOrCreateSupplierAdvanceAccountId, getSupplierAdvanceBalance } from "./advance-accounts";
import { getCustomerBalances } from "./customer-balances";
import { getSupplierBalances } from "./supplier-balances";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const customer = async (name: string) => (await db.insert(customers).values({ tenantId: org.tenantId, name }).returning())[0].id;
const supplier = async (name: string) => (await db.insert(vendors).values({ tenantId: org.tenantId, name }).returning())[0].id;
const post = async (lines: { accountId: string; debitAmount?: number; creditAmount?: number }[], date = "2026-09-01") =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "manual", memo: "t", createdBy: org.userId, lines });

async function invoice(customerId: string, number: string, total: number, date: string) {
  const [inv] = await db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId, invoiceNumber: number, invoiceDate: date, subtotal: String(total), total: String(total), status: "sent" }).returning();
  await post([{ accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, customerId), debitAmount: total }, { accountId: (await acct("4000")).id, creditAmount: total }], date);
  return inv.id;
}
const receive = async (customerId: string, amount: number) =>
  post([{ accountId: (await acct("1000")).id, debitAmount: amount }, { accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, customerId), creditAmount: amount }], "2026-09-10");
const state = async (id: string) => {
  const [i] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, id));
  return { paid: Number(i.amountPaid), status: i.status };
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Settlement");
});
afterAll(async () => {
  await org.remove();
});

describe("settling a customer's invoices from their ledger", () => {
  it("spreads money received over the oldest invoices first", async () => {
    const c = await customer("Fifo");
    const older = await invoice(c, "S-1", 1000, "2026-08-01");
    const newer = await invoice(c, "S-2", 500, "2026-08-15");
    await receive(c, 1200);
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(older)).toEqual({ paid: 1000, status: "paid" });
    expect(await state(newer)).toEqual({ paid: 200, status: "partially_paid" });
  });

  it("money paid together with an invoice stays with that invoice, not with an older unpaid one", async () => {
    const c = await customer("Counter");
    const older = await invoice(c, "S-7", 1000, "2026-07-01");
    const newer = await invoice(c, "S-8", 500, "2026-09-01");
    const receipt = await receive(c, 500); // paid on the spot, recorded with the invoice
    await insertEmbeddedCustomerPayment(org.tenantId, org.userId, c, newer, "2026-09-01", 500, (await acct("1000")).id, receipt.id, "S-8");
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(newer)).toEqual({ paid: 500, status: "paid" });
    expect(await state(older)).toEqual({ paid: 0, status: "sent" });
    await receive(c, 300); // a later payment with no invoice named goes to the oldest open one
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(older)).toEqual({ paid: 300, status: "partially_paid" });
    expect(await state(newer)).toEqual({ paid: 500, status: "paid" });
  });

  it("a payment an earlier version allocated to a specific invoice keeps that invoice", async () => {
    const c = await customer("Legacy");
    const first = await invoice(c, "S-10", 400, "2026-07-01");
    const second = await invoice(c, "S-11", 400, "2026-08-01");
    const receipt = await receive(c, 400);
    const [p] = await db.insert(payments).values({ tenantId: org.tenantId, paymentNumber: "LEG-1", direction: "money_in", paymentType: "customer_payment", paymentDate: "2026-09-10", partyType: "customer", customerId: c, accountId: (await acct("1000")).id, amount: "400.00", status: "posted", journalEntryId: receipt.id, createdBy: org.userId }).returning();
    await db.insert(paymentAllocations).values({ paymentId: p.id, targetType: "sales_invoice", targetId: second, allocatedAmount: "400.00" });
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(second)).toEqual({ paid: 400, status: "paid" });
    expect(await state(first)).toEqual({ paid: 0, status: "sent" });
    await db.update(payments).set({ status: "voided" }).where(eq(payments.id, p.id));
    await post([{ accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, c), debitAmount: 400 }, { accountId: (await acct("1000")).id, creditAmount: 400 }]); // the receipt reversed
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(second)).toEqual({ paid: 0, status: "sent" });
  });

  it("an advance covers an invoice made later, and nothing is left owing", async () => {
    const c = await customer("Advance");
    await receive(c, 700); // money before any invoice: the customer's ledger is in credit
    const inv = await invoice(c, "S-3", 400, "2026-09-05");
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(inv)).toEqual({ paid: 400, status: "paid" });
  });

  it("an invoice no money has reached stays unpaid, and a void invoice takes no part", async () => {
    const c = await customer("Unpaid");
    const live = await invoice(c, "S-4", 300, "2026-09-01");
    const gone = await invoice(c, "S-5", 900, "2026-09-02");
    await db.update(salesInvoices).set({ status: "void" }).where(eq(salesInvoices.id, gone));
    await post([{ accountId: (await acct("4000")).id, debitAmount: 900 }, { accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, c), creditAmount: 900 }]); // its reversal
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(live)).toEqual({ paid: 0, status: "sent" });
    expect((await db.select().from(salesInvoices).where(eq(salesInvoices.id, gone)))[0].status).toBe("void");
  });

  it("puts a document back to unpaid when the money is taken away", async () => {
    const c = await customer("Undo");
    const inv = await invoice(c, "S-6", 600, "2026-09-01");
    await receive(c, 600);
    await resettleParty(org.tenantId, "customer", c);
    expect((await state(inv)).status).toBe("paid");
    await post([{ accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, c), debitAmount: 600 }, { accountId: (await acct("1000")).id, creditAmount: 600 }]); // the receipt reversed
    await resettleParty(org.tenantId, "customer", c);
    expect(await state(inv)).toEqual({ paid: 0, status: "sent" });
  });
});

describe("settling a supplier's bills from their ledger", () => {
  it("spreads payments over the oldest bills first, and keeps the paid part of a bill paid at the counter", async () => {
    const s = await supplier("Acme");
    const ap = await getOrCreateSupplierPayableAccountId(org.tenantId, s);
    const [b1] = await db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId: s, billNumber: "B-1", billDate: "2026-08-01", subtotal: "800", total: "800", status: "open" }).returning();
    const [b2] = await db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId: s, billNumber: "B-2", billDate: "2026-08-20", subtotal: "1000", total: "1000", status: "open" }).returning();
    await post([{ accountId: (await acct("5000")).id, debitAmount: 800 }, { accountId: ap, creditAmount: 800 }], "2026-08-01");
    await post([{ accountId: (await acct("5000")).id, debitAmount: 1000 }, { accountId: (await acct("1000")).id, creditAmount: 400 }, { accountId: ap, creditAmount: 600 }], "2026-08-20"); // 400 paid on the spot
    await post([{ accountId: ap, debitAmount: 500 }, { accountId: (await acct("1000")).id, creditAmount: 500 }], "2026-09-01"); // later payment
    await resettleParty(org.tenantId, "supplier", s);
    const rows = await db.select().from(purchaseBills).where(eq(purchaseBills.vendorId, s));
    const by = (n: string) => ({ paid: Number(rows.find((r) => r.billNumber === n)!.amountPaid), status: rows.find((r) => r.billNumber === n)!.status });
    // owed 900 of 1800, so 900 is cleared: B-1 (800) fully, B-2 100 of 1000
    expect(by("B-1")).toEqual({ paid: 800, status: "paid" });
    expect(by("B-2")).toEqual({ paid: 100, status: "partially_paid" });
    void b1;
    void b2;
  });
});

describe("moving the old Advance accounts onto the party's own ledger", () => {
  it("keeps every net balance, empties the Advance accounts, and settles the documents", async () => {
    const c = await customer("Old advance");
    const advance = await getOrCreateCustomerAdvanceAccountId(org.tenantId, c);
    await post([{ accountId: (await acct("1000")).id, debitAmount: 700 }, { accountId: advance, creditAmount: 700 }]); // paid ahead, never applied
    const inv = await invoice(c, "S-9", 400, "2026-09-05");
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(700);
    expect((await getCustomerBalances(org.tenantId))[c]).toBe(400); // the 700 is on the Advance account, so the invoice looks unpaid

    const s = await supplier("Old prepayment");
    const supAdvance = await getOrCreateSupplierAdvanceAccountId(org.tenantId, s);
    await post([{ accountId: supAdvance, debitAmount: 300 }, { accountId: (await acct("1000")).id, creditAmount: 300 }]); // paid ahead
    expect(await getSupplierAdvanceBalance(org.tenantId, s)).toBe(300);

    const result = await settleAllFromLedger(org.tenantId, org.userId);
    expect(result.moved).toBeGreaterThanOrEqual(1000);
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(0);
    expect(await getSupplierAdvanceBalance(org.tenantId, s)).toBe(0);
    expect((await getCustomerBalances(org.tenantId))[c]).toBe(-300); // 400 invoiced, 700 received
    expect((await getSupplierBalances(org.tenantId))[s]).toBe(-300); // they hold 300 of ours
    expect((await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv)))[0].status).toBe("paid");

    const again = await settleAllFromLedger(org.tenantId, org.userId); // safe to run twice
    expect(again.moved).toBe(0);
  }, 180_000);
});
