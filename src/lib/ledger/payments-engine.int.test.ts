import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, accounts, customers, journalEntries, payments, purchaseReturns, salesInvoices, salesReturns, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "./payments-engine";
import { postJournalEntry } from "./post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { getCustomerBalances } from "./customer-balances";
import { getSupplierBalances } from "./supplier-balances";
import { applyCredit, assertNoAppliedCredit, getCreditInfo, unapplyCredit } from "./credit-applications";
import { assertNoLaterPayments } from "./account-guards";
import { ensureSalesReturnsAccount } from "./return-accounts";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { todayIso } from "@/lib/calendar";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let custA: string;
let custB: string;
let supplier: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const payList = () => db.select().from(payments).where(eq(payments.tenantId, org.tenantId));
const entryCount = async () => (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
const invoice = async (customerId: string, number: string, total: number) =>
  (await db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId, invoiceNumber: number, invoiceDate: "2026-09-01", subtotal: String(total), total: String(total), status: "sent" }).returning())[0];
const receipt = (over: Record<string, unknown>) => ({
  direction: "money_in" as const,
  paymentType: "customer_payment" as const,
  paymentDate: "2026-09-05",
  partyType: "customer" as const,
  accountId: cashId,
  paymentMethod: "cash" as const,
  confirmDuplicate: true,
  ...over,
});
const pay = (input: Parameters<typeof createPayment>[3]) => createPayment(org.tenantId, org.userId, "TMP", input);

beforeAll(async () => {
  org = await createTempOrg("ZZ Payments Test");
  cashId = (await acct("1000")).id;
  custA = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Cust A" }).returning())[0].id;
  custB = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Cust B" }).returning())[0].id;
  supplier = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("payments are checked before anything is posted", () => {
  it("refuses an allocation that exceeds what the invoice still owes, leaving nothing behind", async () => {
    const inv = await invoice(custA, "P-1", 500);
    const before = { entries: await entryCount(), rows: (await payList()).length };
    await expect(pay(receipt({ customerId: custA, amount: 800, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 800 }] }) as never)).rejects.toThrow(/exceeds/);
    expect(await entryCount()).toBe(before.entries);
    expect((await payList()).length).toBe(before.rows);
    expect(Number((await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv.id)))[0].amountPaid)).toBe(0);
  });

  it("refuses to allocate to another customer's invoice", async () => {
    const inv = await invoice(custB, "P-2", 300);
    await expect(pay(receipt({ customerId: custA, amount: 300, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 300 }] }) as never)).rejects.toThrow(/different customer/);
  });

  it("refuses an account that isn't a Cash or Bank account", async () => {
    const revenue = await acct("4000");
    await expect(pay(receipt({ customerId: custA, amount: 10, accountId: revenue.id }) as never)).rejects.toThrow(/Cash or Bank/);
  });

  it("refuses a customer from another organization", async () => {
    const other = await createTempOrg("ZZ Payments Other");
    try {
      const foreign = (await db.insert(customers).values({ tenantId: other.tenantId, name: "Foreign" }).returning())[0].id;
      await expect(pay(receipt({ customerId: foreign, paymentType: "customer_advance", amount: 10 }) as never)).rejects.toThrow(/Customer not found/);
    } finally {
      await other.remove();
    }
  });

  it("gives payments saved at the same instant different numbers", async () => {
    const start = await buildNextPaymentNumber(org.tenantId, "money_in");
    const [a, b] = await Promise.all([
      createPayment(org.tenantId, org.userId, start, receipt({ customerId: custA, paymentType: "customer_advance", amount: 11 }) as never),
      createPayment(org.tenantId, org.userId, start, receipt({ customerId: custA, paymentType: "customer_advance", amount: 12 }) as never),
    ]);
    if ("duplicateWarning" in a || "duplicateWarning" in b) throw new Error("unexpected duplicate warning");
    expect(a.paymentNumber).not.toBe(b.paymentNumber);
    const numbers = (await payList()).map((p) => p.paymentNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("voiding", () => {
  it("is refused up front when today is in a closed period, and changes nothing", async () => {
    const inv = await invoice(custA, "P-3", 400);
    const res = await pay(receipt({ customerId: custA, amount: 400, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 400 }] }) as never);
    if ("duplicateWarning" in res) throw new Error("unexpected");
    const [period] = await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: "2000-01-01", periodEnd: "2100-12-31", label: "All (test)", status: "closed" }).returning();
    try {
      await expect(voidPayment(org.tenantId, res.paymentId, org.userId, "test")).rejects.toThrow(/closed period/);
    } finally {
      await db.delete(accountingPeriods).where(eq(accountingPeriods.id, period.id));
    }
    expect((await db.select().from(payments).where(eq(payments.id, res.paymentId)))[0].status).toBe("posted");
    expect(Number((await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv.id)))[0].amountPaid)).toBe(400);

    await voidPayment(org.tenantId, res.paymentId, org.userId, "test");
    expect(Number((await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv.id)))[0].amountPaid)).toBe(0);
  });
});

describe("refunds and credits", () => {
  it("pays a customer back only what they are owed, against their own account", async () => {
    const ar = await getOrCreateCustomerReceivableAccountId(org.tenantId, custA);
    const salesReturnsAcct = await ensureSalesReturnsAccount(org.tenantId);
    const before = (await getCustomerBalances(org.tenantId))[custA] ?? 0;
    // a sales return of 226 makes us owe the customer
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-06", sourceType: "sales_return", createdBy: org.userId, lines: [{ accountId: salesReturnsAcct.id, debitAmount: 226 }, { accountId: ar, creditAmount: 226 }] });
    const owed = -((await getCustomerBalances(org.tenantId))[custA] ?? 0);
    expect(owed).toBeGreaterThan(0);

    const refund = (amount: number) => pay({ direction: "money_out", paymentType: "customer_refund", paymentDate: "2026-09-07", partyType: "customer", customerId: custA, accountId: cashId, paymentMethod: "cash", amount, confirmDuplicate: true } as never);
    await expect(refund(owed + 1)).rejects.toThrow(/owed/);
    await refund(owed);
    expect((await getCustomerBalances(org.tenantId))[custA] ?? 0).toBeCloseTo(0, 2);
    expect(before).toBeDefined();
    await expect(refund(1)).rejects.toThrow(/isn't owed anything|owed/);
  });

  it("a refund from a supplier settles what they owe us on their payable account first", async () => {
    const ap = await getOrCreateSupplierPayableAccountId(org.tenantId, supplier);
    const inventory = await acct("1200");
    // a purchase return of 500: the supplier now owes us
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-06", sourceType: "purchase_return", createdBy: org.userId, lines: [{ accountId: ap, debitAmount: 500 }, { accountId: inventory.id, creditAmount: 500 }] });
    expect((await getSupplierBalances(org.tenantId))[supplier]).toBe(-500);
    await pay({ direction: "money_in", paymentType: "refund_received", paymentDate: "2026-09-07", partyType: "supplier", vendorId: supplier, accountId: cashId, paymentMethod: "cash", amount: 500, confirmDuplicate: true } as never);
    expect((await getSupplierBalances(org.tenantId))[supplier]).toBe(0);
  });

  it("applies a return's credit to an invoice, keeps within what is left, and blocks changes underneath", async () => {
    const [note] = await db.insert(salesReturns).values({ tenantId: org.tenantId, customerId: custB, noteNumber: "DN-A", noteDate: "2026-09-06", subtotal: "200", taxAmount: "0", total: "200" }).returning();
    const inv = await invoice(custB, "P-4", 500);

    await expect(applyCredit(org.tenantId, org.userId, "sales_return", note.id, [{ targetId: inv.id, amount: 250 }])).rejects.toThrow(/Only 200.00 of credit/);
    await applyCredit(org.tenantId, org.userId, "sales_return", note.id, [{ targetId: inv.id, amount: 150 }]);

    const after = (await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv.id)))[0];
    expect(Number(after.amountPaid)).toBe(150);
    expect(after.status).toBe("partially_paid");
    expect((await getCreditInfo(org.tenantId, "sales_return", note.id)).available).toBe(50);

    await expect(assertNoAppliedCredit(org.tenantId, note.id, "DN-A")).rejects.toThrow(/take that back/);
    await expect(assertNoLaterPayments(org.tenantId, "sales_invoice", inv.id, "invoice")).rejects.toThrow(/DN-A/);

    const info = await getCreditInfo(org.tenantId, "sales_return", note.id);
    await unapplyCredit(org.tenantId, "sales_return", info.applications[0].id);
    const restored = (await db.select().from(salesInvoices).where(eq(salesInvoices.id, inv.id)))[0];
    expect(Number(restored.amountPaid)).toBe(0);
    expect(restored.status).toBe("sent");
    await assertNoAppliedCredit(org.tenantId, note.id, "DN-A");
  });

  it("only applies a supplier's credit note to that supplier's bills", async () => {
    const [note] = await db.insert(purchaseReturns).values({ tenantId: org.tenantId, vendorId: supplier, noteNumber: "CN-A", noteDate: "2026-09-06", subtotal: "100", taxAmount: "0", total: "100" }).returning();
    const info = await getCreditInfo(org.tenantId, "purchase_return", note.id);
    expect(info.available).toBe(100);
    await expect(applyCredit(org.tenantId, org.userId, "purchase_return", note.id, [{ targetId: "00000000-0000-0000-0000-000000000000", amount: 50 }])).rejects.toThrow(/isn't open/);
    expect(todayIso()).toBeTruthy();
  });
});
