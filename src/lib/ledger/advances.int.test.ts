import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, purchaseBills, salesInvoices, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "./payments-engine";
import { postJournalEntry } from "./post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { getCustomerBalances } from "./customer-balances";
import { getSupplierBalances } from "./supplier-balances";
import { getCustomerAdvanceBalance, getOrCreateCustomerAdvanceAccountId, getSupplierAdvanceBalance } from "./advance-accounts";
import { applyAdvance, autoApplyAdvance, getAdvanceInfo, unapplyAdvance } from "./advance-applications";
import { assertNoLaterPayments } from "./account-guards";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const customer = async (name: string) => (await db.insert(customers).values({ tenantId: org.tenantId, name }).returning())[0].id;
const supplierRow = async (name: string) => (await db.insert(vendors).values({ tenantId: org.tenantId, name }).returning())[0].id;

// A sales invoice with its accounting (Dr the customer's receivable account / Cr Sales Revenue).
async function invoice(customerId: string, number: string, total: number, date = "2026-09-01") {
  const [inv] = await db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId, invoiceNumber: number, invoiceDate: date, subtotal: String(total), total: String(total), status: "sent" }).returning();
  const ar = await getOrCreateCustomerReceivableAccountId(org.tenantId, customerId);
  const revenue = await acct("4000");
  await postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "sale", sourceId: inv.id, createdBy: org.userId, lines: [{ accountId: ar, debitAmount: total }, { accountId: revenue.id, creditAmount: total }] });
  return inv;
}
const advancePayment = (customerId: string, amount: number) =>
  createPayment(org.tenantId, org.userId, "TMP", { direction: "money_in", paymentType: "customer_advance", paymentDate: "2026-09-02", partyType: "customer", customerId, accountId: cashId, paymentMethod: "cash", amount, confirmDuplicate: true });
const paidOn = async (id: string) => (await db.select().from(salesInvoices).where(eq(salesInvoices.id, id)))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Advances Test");
  cashId = (await acct("1000")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("customer advances", () => {
  it("each customer has their own advance account, even when two share a name", async () => {
    const a = await customer("Twin");
    const b = await customer("Twin");
    await advancePayment(a, 700);
    await advancePayment(b, 300);
    expect(await getOrCreateCustomerAdvanceAccountId(org.tenantId, a)).not.toBe(await getOrCreateCustomerAdvanceAccountId(org.tenantId, b));
    expect(await getCustomerAdvanceBalance(org.tenantId, a)).toBe(700);
    expect(await getCustomerAdvanceBalance(org.tenantId, b)).toBe(300);
    // renaming a customer doesn't lose their advance
    await db.update(customers).set({ name: "Twin (renamed)" }).where(eq(customers.id, a));
    expect(await getCustomerAdvanceBalance(org.tenantId, a)).toBe(700);
    await advancePayment(a, 100);
    expect(await getCustomerAdvanceBalance(org.tenantId, a)).toBe(800);
  });

  it("is applied to the OLDEST open invoices first", async () => {
    const c = await customer("Fifo");
    const older = await invoice(c, "F-1", 1000, "2026-08-01");
    const newer = await invoice(c, "F-2", 1000, "2026-08-15");
    await advancePayment(c, 1500);
    expect(await autoApplyAdvance(org.tenantId, org.userId, "customer", c)).toBe(1500);

    expect(Number((await paidOn(older.id)).amountPaid)).toBe(1000);
    expect((await paidOn(older.id)).status).toBe("paid");
    expect(Number((await paidOn(newer.id)).amountPaid)).toBe(500);
    expect((await paidOn(newer.id)).status).toBe("partially_paid");
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(0);
    expect((await getCustomerBalances(org.tenantId))[c]).toBe(500); // 2000 billed - 1500 advance
  });

  it("can be applied by hand, kept within what is owed and what is available, and taken back", async () => {
    const c = await customer("Manual");
    const inv = await invoice(c, "M-1", 800);
    await advancePayment(c, 500);

    await expect(applyAdvance(org.tenantId, org.userId, "customer", inv.id, 600)).rejects.toThrow(/advance is available|Only 500.00/);
    await applyAdvance(org.tenantId, org.userId, "customer", inv.id, 300);
    expect(Number((await paidOn(inv.id)).amountPaid)).toBe(300);
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(200);

    // an invoice with an advance applied can't be edited or voided underneath it
    await expect(assertNoLaterPayments(org.tenantId, "sales_invoice", inv.id, "invoice")).rejects.toThrow(/advance of 300.00/);

    const info = await getAdvanceInfo(org.tenantId, "customer", inv.id);
    expect(info.applications).toHaveLength(1);
    await unapplyAdvance(org.tenantId, org.userId, "customer", info.applications[0].id);
    expect(Number((await paidOn(inv.id)).amountPaid)).toBe(0);
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(500);
    await assertNoLaterPayments(org.tenantId, "sales_invoice", inv.id, "invoice");
  });

  it("can be refunded, and only up to what is left", async () => {
    const c = await customer("Refund");
    await advancePayment(c, 2000);
    const refund = (amount: number) => createPayment(org.tenantId, org.userId, "TMP", { direction: "money_out", paymentType: "customer_refund", paymentDate: "2026-09-03", partyType: "customer", customerId: c, accountId: cashId, paymentMethod: "cash", amount, confirmDuplicate: true });
    await refund(500);
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(1500);
    await expect(refund(1600)).rejects.toThrow(/advance 1500.00/);
  });

  it("can't be voided once it has been applied", async () => {
    const c = await customer("Voiding");
    const inv = await invoice(c, "V-1", 400);
    const res = await advancePayment(c, 400);
    if ("duplicateWarning" in res) throw new Error("unexpected");
    await autoApplyAdvance(org.tenantId, org.userId, "customer", c);
    expect((await paidOn(inv.id)).status).toBe("paid");
    await expect(voidPayment(org.tenantId, res.paymentId, org.userId, "test")).rejects.toThrow(/already been applied or refunded/);

    const info = await getAdvanceInfo(org.tenantId, "customer", inv.id);
    await unapplyAdvance(org.tenantId, org.userId, "customer", info.applications[0].id);
    await voidPayment(org.tenantId, res.paymentId, org.userId, "test");
    expect(await getCustomerAdvanceBalance(org.tenantId, c)).toBe(0);
  });
});

describe("supplier advances", () => {
  it("an advance paid to a supplier is applied to their oldest open bill", async () => {
    const s = await supplierRow("Adv Supplier");
    const ap = await getOrCreateSupplierPayableAccountId(org.tenantId, s);
    const inventory = await acct("1200");
    const [bill] = await db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId: s, billNumber: "AB-1", billDate: "2026-09-01", subtotal: "600", total: "600", status: "open" }).returning();
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "purchase", sourceId: bill.id, createdBy: org.userId, lines: [{ accountId: inventory.id, debitAmount: 600 }, { accountId: ap, creditAmount: 600 }] });

    await createPayment(org.tenantId, org.userId, "TMP", { direction: "money_out", paymentType: "supplier_advance", paymentDate: "2026-09-02", partyType: "supplier", vendorId: s, accountId: cashId, paymentMethod: "cash", amount: 1000, confirmDuplicate: true });
    expect(await getSupplierAdvanceBalance(org.tenantId, s)).toBe(1000);

    expect(await autoApplyAdvance(org.tenantId, org.userId, "supplier", s)).toBe(600);
    const after = (await db.select().from(purchaseBills).where(eq(purchaseBills.id, bill.id)))[0];
    expect(Number(after.amountPaid)).toBe(600);
    expect(after.status).toBe("paid");
    expect(await getSupplierAdvanceBalance(org.tenantId, s)).toBe(400);
    expect((await getSupplierBalances(org.tenantId))[s]).toBe(0);
  });
});
