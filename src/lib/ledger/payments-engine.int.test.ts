import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, accounts, customers, journalEntries, journalLines, payments, salesInvoices, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "./payments-engine";
import { postJournalEntry } from "./post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { getCustomerBalances } from "./customer-balances";
import { getSupplierBalances } from "./supplier-balances";
import { resettleParty } from "./party-settlement";
import { ensureSalesReturnsAccount } from "./return-accounts";
import { buildNextPaymentNumber } from "@/lib/payment-number";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let custA: string;
let custB: string;
let supplier: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const payList = () => db.select().from(payments).where(eq(payments.tenantId, org.tenantId));
const entryCount = async () => (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
const invoice = async (customerId: string, number: string, total: number, date = "2026-09-01") => {
  const [inv] = await db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId, invoiceNumber: number, invoiceDate: date, subtotal: String(total), total: String(total), status: "sent" }).returning();
  await postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "sale", sourceId: inv.id, createdBy: org.userId, lines: [{ accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, customerId), debitAmount: total }, { accountId: (await acct("4000")).id, creditAmount: total }] });
  return inv;
};
const invoiceRow = async (id: string) => (await db.select().from(salesInvoices).where(eq(salesInvoices.id, id)))[0];
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
  it("takes no allocation to invoices on a customer payment: the money goes on the customer's own account", async () => {
    const inv = await invoice(custA, "P-1", 500);
    const before = { entries: await entryCount(), rows: (await payList()).length };
    await expect(pay(receipt({ customerId: custA, amount: 300, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 300 }] }) as never)).rejects.toThrow(/can't settle that kind/);
    expect(await entryCount()).toBe(before.entries);
    expect((await payList()).length).toBe(before.rows);
    expect(Number((await invoiceRow(inv.id)).amountPaid)).toBe(0);
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
    // a customer of their own: money settles a customer's OLDEST invoice first, so older open ones would take it
    const custV = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Void Customer" }).returning())[0].id;
    const inv = await invoice(custV, "P-3", 400);
    const res = await pay(receipt({ customerId: custV, amount: 400 }) as never);
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
    // a customer with no advance, so only the return credit can be refunded
    const custR = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Refund Customer" }).returning())[0].id;
    const ar = await getOrCreateCustomerReceivableAccountId(org.tenantId, custR);
    const salesReturnsAcct = await ensureSalesReturnsAccount(org.tenantId);
    const before = (await getCustomerBalances(org.tenantId))[custR] ?? 0;
    // a sales return of 226 makes us owe the customer
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-06", sourceType: "sales_return", createdBy: org.userId, lines: [{ accountId: salesReturnsAcct.id, debitAmount: 226 }, { accountId: ar, creditAmount: 226 }] });
    const owed = -((await getCustomerBalances(org.tenantId))[custR] ?? 0);
    expect(owed).toBeGreaterThan(0);

    const refund = (amount: number) => pay({ direction: "money_out", paymentType: "customer_refund", paymentDate: "2026-09-07", partyType: "customer", customerId: custR, accountId: cashId, paymentMethod: "cash", amount, confirmDuplicate: true } as never);
    await expect(refund(owed + 1)).rejects.toThrow(/owed/);
    await refund(owed);
    expect((await getCustomerBalances(org.tenantId))[custR] ?? 0).toBeCloseTo(0, 2);
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

  it("a credit note settles the customer's oldest invoice from their ledger, with nothing to apply by hand", async () => {
    const inv = await invoice(custB, "P-4", 500);
    const salesReturnsAcct = await ensureSalesReturnsAccount(org.tenantId);
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-06", sourceType: "sales_return", createdBy: org.userId, lines: [{ accountId: salesReturnsAcct.id, debitAmount: 150 }, { accountId: await getOrCreateCustomerReceivableAccountId(org.tenantId, custB), creditAmount: 150 }] });
    await resettleParty(org.tenantId, "customer", custB);
    const after = await invoiceRow(inv.id);
    expect(Number(after.amountPaid)).toBe(150);
    expect(after.status).toBe("partially_paid");
  });
});

describe("money paid ahead", () => {
  it("goes on the customer's own account, not an advance account, and covers an invoice made later", async () => {
    const custC = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Prepay" }).returning())[0].id;
    const res = await pay(receipt({ customerId: custC, amount: 700 }) as never);
    if ("duplicateWarning" in res) throw new Error("unexpected");
    const lines = await db.select({ code: accounts.code, name: accounts.name, credit: journalLines.creditAmount }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).innerJoin(payments, eq(payments.journalEntryId, journalLines.journalEntryId)).where(eq(payments.id, res.paymentId));
    expect(lines.some((l) => /advance/i.test(l.name))).toBe(false);
    expect((await getCustomerBalances(org.tenantId))[custC]).toBe(-700);

    const inv = await invoice(custC, "P-5", 400);
    await resettleParty(org.tenantId, "customer", custC);
    expect(await invoiceRow(inv.id)).toMatchObject({ status: "paid", amountPaid: "400.00" });
    expect((await getCustomerBalances(org.tenantId))[custC]).toBe(-300);
  });

  it("puts the invoices back to unpaid when that payment is voided", async () => {
    const custD = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Void me" }).returning())[0].id;
    const inv = await invoice(custD, "P-6", 250);
    const res = await pay(receipt({ customerId: custD, amount: 250 }) as never);
    if ("duplicateWarning" in res) throw new Error("unexpected");
    expect((await invoiceRow(inv.id)).status).toBe("paid");
    await voidPayment(org.tenantId, res.paymentId, org.userId, "test");
    expect(await invoiceRow(inv.id)).toMatchObject({ status: "sent", amountPaid: "0.00" });
  });
});
