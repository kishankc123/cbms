import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, accounts, items, journalEntries, journalLines, paymentAllocations, payments, purchaseBills, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry } from "@/lib/ledger/post";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createPurchaseInvoice, updatePurchaseInvoice, voidBill, createCashPurchaseBatch } = await import("./actions");

const acct = async (tenantId: string, code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(org.tenantId, code);
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0);
}
const bills = () => db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId));
const line = (rate: number, quantity: number, itemId: string | null = null) => ({ itemId, description: "Widget", rate, quantity, discount: 0 });

let vendorA: string;
let vendorB: string;
let cashId: string;
let categoryId: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Purchases Test");
  other = await createTempOrg("ZZ Purchases Other");
  [{ id: vendorA }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier A" }).returning({ id: vendors.id });
  [{ id: vendorB }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier B" }).returning({ id: vendors.id });
  cashId = (await acct(org.tenantId, "1000")).id;
  const cogs = await acct(org.tenantId, "5000");
  categoryId = (await createSubAccount(org.tenantId, cogs, "Consumables")).id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("the ledger only posts to this organization's active accounts", () => {
  it("refuses another organization's account", async () => {
    const foreign = await acct(other.tenantId, "1000");
    const mine = await acct(org.tenantId, "1010");
    await expect(
      postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: foreign.id, debitAmount: 10 }, { accountId: mine.id, creditAmount: 10 }] })
    ).rejects.toThrow(/isn't in this organization/);
  });
  it("refuses an inactive account", async () => {
    const [a] = await db.update(accounts).set({ isActive: false }).where(eq(accounts.id, (await acct(org.tenantId, "5100")).id)).returning();
    const mine = await acct(org.tenantId, "1010");
    await expect(
      postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: a.id, debitAmount: 10 }, { accountId: mine.id, creditAmount: 10 }] })
    ).rejects.toThrow(/inactive/);
  });
  it("purchases refuse a payment account from another organization", async () => {
    const foreign = await acct(other.tenantId, "1000");
    await expect(createPurchaseInvoice({ invoiceNumber: "X-1", invoiceDate: "2026-09-01", vendorId: vendorA, billType: "no_bill", lines: [line(100, 1)], payments: [{ accountId: foreign.id, amount: 100 }] })).rejects.toThrow(/Cash or Bank/);
    expect((await bills()).length).toBe(0);
  });
});

describe("stockable purchases", () => {
  it("VAT is part of the cost until the organization is VAT-registered, then it is claimed", async () => {
    await createPurchaseInvoice({ invoiceNumber: "S-1", invoiceDate: "2026-09-01", vendorId: vendorA, billType: "vat", lines: [line(1000, 1)], payments: [] });
    expect(await balance("1200")).toBe(1130);
    expect(await balance("1300")).toBe(0);

    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    await createPurchaseInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-01", vendorId: vendorA, billType: "vat", lines: [line(1000, 1)], payments: [] });
    expect(await balance("1200")).toBe(1130 + 1000);
    expect(await balance("1300")).toBe(130);
  });

  it("a bill number is unique per supplier, but two suppliers may share one", async () => {
    await expect(createPurchaseInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-02", vendorId: vendorA, billType: "no_bill", lines: [line(10, 1)], payments: [] })).rejects.toThrow(/already recorded/);
    await createPurchaseInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-02", vendorId: vendorB, billType: "no_bill", lines: [line(10, 1)], payments: [] });
  });

  it("a due date in the past of the invoice date is refused; a valid one is stored", async () => {
    await expect(createPurchaseInvoice({ invoiceNumber: "S-3", invoiceDate: "2026-09-05", dueDate: "2026-09-01", vendorId: vendorA, billType: "no_bill", lines: [line(10, 1)], payments: [] })).rejects.toThrow(/due date/);
    await createPurchaseInvoice({ invoiceNumber: "S-3", invoiceDate: "2026-09-05", dueDate: "2026-10-05", vendorId: vendorA, billType: "no_bill", lines: [line(10, 1)], payments: [] });
    expect((await bills()).find((b) => b.billNumber === "S-3" && b.vendorId === vendorA)!.dueDate).toBe("2026-10-05");
  });

  it("a locked period refuses the bill and leaves nothing behind", async () => {
    await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: "2026-01-01", periodEnd: "2026-01-31", label: "Jan (test)", status: "closed" });
    const before = (await bills()).length;
    await expect(createPurchaseInvoice({ invoiceNumber: "S-LOCK", invoiceDate: "2026-01-15", vendorId: vendorA, billType: "no_bill", lines: [line(10, 1)], payments: [] })).rejects.toThrow(/closed period/);
    expect((await bills()).length).toBe(before);
  });

  it("can't be edited or voided under a payment made later in Payments", async () => {
    const bill = (await bills()).find((b) => b.billNumber === "S-3" && b.vendorId === vendorA)!;
    const [p] = await db
      .insert(payments)
      .values({ tenantId: org.tenantId, paymentNumber: "MO-TEST-1", direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-06", partyType: "supplier", vendorId: vendorA, accountId: cashId, amount: "5.00", createdBy: org.userId })
      .returning();
    await db.insert(paymentAllocations).values({ paymentId: p.id, targetType: "purchase_bill", targetId: bill.id, allocatedAmount: "5.00" });

    const fd = Object.assign(new FormData(), { get: () => bill.id }) as unknown as FormData;
    await expect(voidBill(fd)).rejects.toThrow(/MO-TEST-1/);
    await expect(updatePurchaseInvoice({ billId: bill.id, invoiceNumber: "S-3", invoiceDate: "2026-09-05", vendorId: vendorA, billType: "no_bill", lines: [line(20, 1)], payments: [] })).rejects.toThrow(/MO-TEST-1/);
  });

  it("stock that has already been sold can't be taken back out by voiding", async () => {
    const [item] = await db.insert(items).values({ tenantId: org.tenantId, name: "Gadget", purchasePrice: "10", sellingPrice: "20", stockQuantity: "0" }).returning();
    await createPurchaseInvoice({ invoiceNumber: "S-STK", invoiceDate: "2026-09-07", vendorId: vendorB, billType: "no_bill", lines: [line(10, 5, item.id)], payments: [] });
    await db.update(items).set({ stockQuantity: "2" }).where(eq(items.id, item.id)); // 3 of the 5 were sold
    const bill = (await bills()).find((b) => b.billNumber === "S-STK")!;
    await expect(voidBill(Object.assign(new FormData(), { get: () => bill.id }) as unknown as FormData)).rejects.toThrow(/in stock/);
    expect((await bills()).find((b) => b.id === bill.id)!.status).not.toBe("void");
  });
});

describe("consumable purchases", () => {
  const row = (over: Record<string, unknown> = {}) => ({ billNumber: "", billDate: "2026-09-08", vendorId: "", categoryId, billType: "no_bill" as const, description: "Paper", amount: 100, payments: [{ accountId: cashId, amount: 100 }], ...over });

  it("refuses payments that don't add up to the bill, and saves nothing", async () => {
    const before = (await bills()).length;
    await expect(createCashPurchaseBatch({ rows: [row({ payments: [{ accountId: cashId, amount: 90 }] })] })).rejects.toThrow(/must equal the bill total/);
    expect((await bills()).length).toBe(before);
  });

  it("refuses a category that isn't one of this organization's purchase categories", async () => {
    const foreign = await acct(other.tenantId, "5000");
    await expect(createCashPurchaseBatch({ rows: [row({ categoryId: foreign.id })] })).rejects.toThrow(/valid purchase category/);
  });

  it("numbers bills without a supplier number without clashing", async () => {
    await createCashPurchaseBatch({ rows: [row(), row()] });
    const autos = (await bills()).filter((b) => b.billNumber.startsWith("AUTO-")).map((b) => b.billNumber);
    expect(new Set(autos).size).toBe(autos.length);
    expect(autos.length).toBe(2);
  });
});
