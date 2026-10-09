import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, customers, journalEntries, journalLines, payments, paymentAllocations, purchaseBills, salesInvoices, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, updatePayment, voidPayment, type UpdatePaymentInput } from "./payments-engine";
import { createTransfer, updateTransfer } from "./inter-transfers";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let bankId: string;
let custA: string;
let supplier: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const invoice = async (number: string, total: number) =>
  (await db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId: custA, invoiceNumber: number, invoiceDate: "2026-09-01", subtotal: String(total), total: String(total), status: "sent" }).returning())[0];
const bill = async (number: string, total: number) =>
  (await db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId: supplier, billNumber: number, billDate: "2026-09-01", subtotal: String(total), total: String(total), status: "open" }).returning())[0];
const invoiceRow = async (id: string) => (await db.select().from(salesInvoices).where(eq(salesInvoices.id, id)))[0];
const entryCount = async () => (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;

const receipt = (over: Record<string, unknown>) => ({
  direction: "money_in" as const,
  paymentType: "customer_payment" as const,
  paymentDate: "2026-09-05",
  partyType: "customer" as const,
  customerId: custA,
  accountId: cashId,
  paymentMethod: "cash" as const,
  confirmDuplicate: true,
  ...over,
});
const pay = (input: Parameters<typeof createPayment>[3]) => createPayment(org.tenantId, org.userId, "TMP", input);
const edit = (paymentId: string, input: Partial<UpdatePaymentInput>, base: UpdatePaymentInput) => updatePayment(org.tenantId, org.userId, paymentId, { ...base, ...input });
const baseOf = (over: Partial<UpdatePaymentInput> = {}): UpdatePaymentInput => ({
  paymentDate: "2026-09-05",
  partyType: "customer",
  customerId: custA,
  accountId: cashId,
  paymentMethod: "cash",
  amount: 500,
  ...over,
});
const paymentRow = async (id: string) => (await db.select().from(payments).where(eq(payments.id, id)))[0];
const cashBalance = async (accountId: string) => {
  const lines = await db.select().from(journalLines).where(eq(journalLines.accountId, accountId));
  return lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0);
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Payment Edit Test");
  cashId = (await acct("1000")).id;
  bankId = (await db.insert(accounts).values({ tenantId: org.tenantId, code: "1010.01", name: "Test Bank", category: "asset", subCategory: "Current assets", parentAccountId: (await acct("1010")).id }).returning())[0].id;
  custA = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Cust A" }).returning())[0].id;
  supplier = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("editing a payment", () => {
  it("changes the amount and the account: the books follow and the invoice is put right", async () => {
    const inv = await invoice("E-1", 1000);
    const res = (await pay(receipt({ amount: 400, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 400 }] }) as never)) as { paymentId: string; paymentNumber: string };
    expect(Number((await invoiceRow(inv.id)).amountPaid)).toBe(400);
    const cashBefore = await cashBalance(cashId);

    const result = await edit(res.paymentId, { amount: 700, accountId: bankId, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 700 }] }, baseOf());
    expect(result.changed).toBe(true);
    if (result.changed) expect(result.changes.map((c) => c.field).sort()).toEqual(["Account", "Amount", "Settles"]);

    const row = await paymentRow(res.paymentId);
    expect(row.paymentNumber).toBe(res.paymentNumber); // same payment, same number
    expect(row.accountId).toBe(bankId);
    expect(Number(row.amount)).toBe(700);
    expect(row.updatedBy).toBe(org.userId);
    expect(Number((await invoiceRow(inv.id)).amountPaid)).toBe(700);
    expect((await invoiceRow(inv.id)).status).toBe("partially_paid");
    expect((await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, res.paymentId))).map((a) => Number(a.allocatedAmount))).toEqual([700]);
    // the old cash line is gone, the bank holds the new amount
    expect(await cashBalance(cashId)).toBe(cashBefore - 400);
    expect(await cashBalance(bankId)).toBe(700);
  });

  it("writes what changed to the audit log", async () => {
    const inv = await invoice("E-2", 600);
    const res = (await pay(receipt({ amount: 200, referenceNumber: "REF-1", allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 200 }] }) as never)) as { paymentId: string };
    await edit(res.paymentId, { amount: 250, referenceNumber: "REF-2", notes: "corrected", allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 250 }] }, baseOf());
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.entityId, res.paymentId))).orderBy(desc(auditLog.timestamp)).limit(1);
    expect(log.action).toBe("payment_edited");
    expect(log.entityType).toBe("payment");
    expect(log.userId).toBe(org.userId);
    expect(log.beforeValue).toMatchObject({ Amount: "200.00", Reference: "REF-1", Notes: "—", Settles: "E-2: 200.00" });
    expect(log.afterValue).toMatchObject({ Amount: "250.00", Reference: "REF-2", Notes: "corrected", Settles: "E-2: 250.00" });
    // only what changed is recorded
    expect(Object.keys(log.afterValue as object)).not.toContain("Party");
  });

  it("moves the payment to another invoice, freeing the first", async () => {
    const a = await invoice("E-3A", 300);
    const b = await invoice("E-3B", 300);
    const res = (await pay(receipt({ amount: 300, allocations: [{ targetType: "sales_invoice", targetId: a.id, allocatedAmount: 300 }] }) as never)) as { paymentId: string };
    expect((await invoiceRow(a.id)).status).toBe("paid");
    await edit(res.paymentId, { amount: 300, allocations: [{ targetType: "sales_invoice", targetId: b.id, allocatedAmount: 300 }] }, baseOf());
    expect(Number((await invoiceRow(a.id)).amountPaid)).toBe(0);
    expect((await invoiceRow(a.id)).status).toBe("sent");
    expect(Number((await invoiceRow(b.id)).amountPaid)).toBe(300);
    expect((await invoiceRow(b.id)).status).toBe("paid");
  });

  it("lets a payment keep settling an invoice it already fully settles (its own amount is free again)", async () => {
    const inv = await invoice("E-4", 500);
    const res = (await pay(receipt({ amount: 500, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 500 }] }) as never)) as { paymentId: string };
    const r = await edit(res.paymentId, { paymentDate: "2026-09-06", allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 500 }] }, baseOf());
    expect(r.changed).toBe(true);
    expect(Number((await invoiceRow(inv.id)).amountPaid)).toBe(500);
    expect((await paymentRow(res.paymentId)).paymentDate).toBe("2026-09-06");
  });

  it("refuses a change that would settle more than the invoice owes, and leaves everything as it was", async () => {
    const inv = await invoice("E-5", 400);
    const res = (await pay(receipt({ amount: 400, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 400 }] }) as never)) as { paymentId: string };
    const entries = await entryCount();
    await expect(edit(res.paymentId, { amount: 900, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 900 }] }, baseOf())).rejects.toThrow(/exceeds/);
    expect(await entryCount()).toBe(entries);
    expect(Number((await paymentRow(res.paymentId)).amount)).toBe(400);
    expect(Number((await invoiceRow(inv.id)).amountPaid)).toBe(400);
  });

  it("does nothing, and logs nothing, when nothing changed", async () => {
    const inv = await invoice("E-6", 100);
    const res = (await pay(receipt({ amount: 100, allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 100 }] }) as never)) as { paymentId: string };
    const entries = await entryCount();
    const r = await edit(res.paymentId, { allocations: [{ targetType: "sales_invoice", targetId: inv.id, allocatedAmount: 100 }], amount: 100 }, baseOf());
    expect(r).toEqual({ changed: false });
    expect(await entryCount()).toBe(entries);
    expect((await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.entityId, res.paymentId)))).length).toBe(0);
  });

  it("edits a supplier payment and an advance", async () => {
    const b = await bill("S-1", 800);
    const sp = (await pay({ direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-05", partyType: "supplier", vendorId: supplier, accountId: cashId, paymentMethod: "cash", amount: 300, allocations: [{ targetType: "purchase_bill", targetId: b.id, allocatedAmount: 300 }], confirmDuplicate: true })) as { paymentId: string };
    const supplierBase: UpdatePaymentInput = { paymentDate: "2026-09-05", partyType: "supplier", vendorId: supplier, accountId: cashId, paymentMethod: "cash", amount: 300 };
    await edit(sp.paymentId, { amount: 500, allocations: [{ targetType: "purchase_bill", targetId: b.id, allocatedAmount: 500 }] }, supplierBase);
    expect(Number((await db.select().from(purchaseBills).where(eq(purchaseBills.id, b.id)))[0].amountPaid)).toBe(500);

    const adv = (await pay(receipt({ paymentType: "customer_advance", amount: 250 }) as never)) as { paymentId: string };
    const r = await edit(adv.paymentId, { amount: 350 }, baseOf());
    expect(r.changed).toBe(true);
    expect(Number((await paymentRow(adv.paymentId)).amount)).toBe(350);
  });

  it("refuses payments that cannot be edited here: voided ones and ones an invoice recorded", async () => {
    const res = (await pay(receipt({ paymentType: "customer_advance", amount: 120 }) as never)) as { paymentId: string };
    await voidPayment(org.tenantId, res.paymentId, org.userId, "test");
    await expect(edit(res.paymentId, { amount: 130 }, baseOf())).rejects.toThrow(/voided/);

    const emb = (await pay(receipt({ paymentType: "customer_advance", amount: 80, origin: "embedded" }) as never)) as { paymentId: string };
    await expect(edit(emb.paymentId, { amount: 90 }, baseOf())).rejects.toThrow(/source invoice/);
  });

  it("refuses an edit that moves the payment into a closed period", async () => {
    const res = (await pay(receipt({ paymentType: "customer_advance", amount: 60 }) as never)) as { paymentId: string };
    const { accountingPeriods } = await import("@/db/schema");
    await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: "2025-01-01", periodEnd: "2025-01-31", label: "Jan 2025", status: "closed" });
    await expect(edit(res.paymentId, { paymentDate: "2025-01-15", amount: 60 }, baseOf())).rejects.toThrow(/closed/i);
    expect((await paymentRow(res.paymentId)).paymentDate).toBe("2026-09-05");
  });
});

describe("editing an inter-transfer", () => {
  it("records what changed in the audit log, and does nothing when nothing changed", async () => {
    const t = await createTransfer(org.tenantId, org.userId, { transferDate: "2026-09-07", fromAccountId: cashId, toAccountId: bankId, amount: 900, reference: "T-REF" });
    const same = await updateTransfer(org.tenantId, org.userId, t.id, { transferDate: "2026-09-07", fromAccountId: cashId, toAccountId: bankId, amount: 900, reference: "T-REF" });
    expect(same).toEqual({ changed: false });

    const r = await updateTransfer(org.tenantId, org.userId, t.id, { transferDate: "2026-09-08", fromAccountId: cashId, toAccountId: bankId, amount: 950, reference: "T-REF-2", description: "fixed" });
    expect(r.changed).toBe(true);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.entityId, t.id))).orderBy(desc(auditLog.timestamp)).limit(1);
    expect(log.action).toBe("inter_transfer_edited");
    expect(log.entityType).toBe("inter_transfer");
    expect(log.beforeValue).toMatchObject({ "Transfer date": "2026-09-07", Amount: "900.00", Reference: "T-REF", Description: "—" });
    expect(log.afterValue).toMatchObject({ "Transfer date": "2026-09-08", Amount: "950.00", Reference: "T-REF-2", Description: "fixed" });
    expect(Object.keys(log.afterValue as object)).not.toContain("From account");
  });
});
