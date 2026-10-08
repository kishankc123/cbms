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

const { createPurchaseInvoice, updatePurchaseInvoice, voidBill, createCashPurchase, updateCashPurchase, getCashPurchaseForEdit } = await import("./actions");

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
// A stockable purchase line always names an item; most tests here don't care which.
let defaultItemId: string;
const line = (rate: number, quantity: number, itemId: string | null = null) => ({ itemId: itemId ?? defaultItemId, description: "Widget", rate, quantity, discount: 0 });

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
  defaultItemId = (await db.insert(items).values({ tenantId: org.tenantId, name: "Default item" }).returning({ id: items.id }))[0].id;
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

  it("a non-VAT invoice paid in full needs no supplier and no invoice number; a VAT invoice or an unpaid balance does", async () => {
    const before = (await bills()).length;
    for (const billType of ["no_bill", "estimate", "pan", "challan"] as const) {
      await createPurchaseInvoice({ invoiceNumber: "", invoiceDate: "2026-09-01", vendorId: "", billType, lines: [line(100, 1)], payments: [{ accountId: cashId, amount: 100 }] });
    }
    const made = (await bills()).filter((b) => b.vendorId === null && b.billType !== "vat" && b.billNumber.startsWith("AUTO-") && b.billType !== undefined && ["no_bill", "estimate", "pan", "challan"].includes(b.billType) && b.purchaseType === "credit");
    expect(made).toHaveLength(4);
    expect(made.every((b) => b.vendorId === null && /^AUTO-\d+$/.test(b.billNumber) && b.status === "paid")).toBe(true);
    expect(new Set(made.map((b) => b.billNumber)).size).toBe(4); // numbers never clash

    // VAT: both are needed, even when paid in full
    await expect(createPurchaseInvoice({ invoiceNumber: "", invoiceDate: "2026-09-01", vendorId: vendorA, billType: "vat", lines: [line(100, 1)], payments: [{ accountId: cashId, amount: 113 }] })).rejects.toThrow(/Invoice number is required.*VAT bill/);
    await expect(createPurchaseInvoice({ invoiceNumber: "V-1", invoiceDate: "2026-09-01", vendorId: "", billType: "vat", lines: [line(100, 1)], payments: [{ accountId: cashId, amount: 113 }] })).rejects.toThrow(/Select a supplier.*VAT bill/);
    // a balance that is not paid: owed to a supplier
    await expect(createPurchaseInvoice({ invoiceNumber: "", invoiceDate: "2026-09-01", vendorId: vendorA, billType: "no_bill", lines: [line(100, 1)], payments: [{ accountId: cashId, amount: 40 }] })).rejects.toThrow(/Invoice number is required.*balance is owed/);
    await expect(createPurchaseInvoice({ invoiceNumber: "P-1", invoiceDate: "2026-09-01", vendorId: "", billType: "no_bill", lines: [line(100, 1)], payments: [] })).rejects.toThrow(/Select a supplier/);
    expect((await bills()).length).toBe(before + 4); // the refusals saved nothing
  });

  it("a supplier-less invoice can be edited, keeping its generated number, and still posts straight to cash and stock", async () => {
    const b = (await bills()).find((x) => x.vendorId === null && x.billType === "no_bill" && x.billNumber.startsWith("AUTO-"))!;
    await updatePurchaseInvoice({ billId: b.id, invoiceNumber: "", invoiceDate: "2026-09-01", vendorId: "", billType: "no_bill", lines: [line(150, 1)], payments: [{ accountId: cashId, amount: 150 }] });
    const [after] = await db.select().from(purchaseBills).where(eq(purchaseBills.id, b.id));
    expect(after).toMatchObject({ billNumber: b.billNumber, vendorId: null, status: "paid", total: "150.00" });
    // partly paid now: a supplier is required
    await expect(updatePurchaseInvoice({ billId: b.id, invoiceNumber: "", invoiceDate: "2026-09-01", vendorId: "", billType: "no_bill", lines: [line(150, 1)], payments: [{ accountId: cashId, amount: 50 }] })).rejects.toThrow(/Invoice number is required|Select a supplier/);
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
  const purchase = (over: Record<string, unknown> = {}) => ({
    billNumber: "",
    billDate: "2026-09-08",
    vendorId: "",
    billType: "no_bill" as const,
    lines: [{ description: "Paper", categoryId, rate: 50, quantity: 2, discount: 0 }],
    payments: [{ accountId: cashId, amount: 100 }],
    ...over,
  });

  it("refuses a payment larger than the bill, and saves nothing", async () => {
    const before = (await bills()).length;
    await expect(createCashPurchase(purchase({ vendorId: vendorA, payments: [{ accountId: cashId, amount: 150 }] }))).rejects.toThrow(/cannot exceed the bill total/);
    expect((await bills()).length).toBe(before);
  });

  it("does not assume the bill is paid: a part-paid or unpaid bill is owed to the supplier, who is then required", async () => {
    const before = (await bills()).length;
    await expect(createCashPurchase(purchase({ payments: [{ accountId: cashId, amount: 90 }] }))).rejects.toThrow(/Select a supplier/);
    await expect(createCashPurchase(purchase({ payments: [] }))).rejects.toThrow(/Select a supplier/);
    expect((await bills()).length).toBe(before);

    await createCashPurchase(purchase({ billNumber: "CP-PART", vendorId: vendorA, payments: [{ accountId: cashId, amount: 90 }] }));
    await createCashPurchase(purchase({ billNumber: "CP-NONE", vendorId: vendorA, payments: [] }));
    const part = (await bills()).find((b) => b.billNumber === "CP-PART")!;
    const none = (await bills()).find((b) => b.billNumber === "CP-NONE")!;
    expect(part.status).toBe("partially_paid");
    expect(Number(part.amountPaid)).toBe(90);
    expect(none.status).toBe("open");
    expect(Number(none.amountPaid)).toBe(0);

    // The supplier's unpaid balance is not mistaken for a payment when the bill is opened for editing.
    const edit = await getCashPurchaseForEdit(part.id);
    expect(edit.payments).toEqual([{ accountId: cashId, amount: 90, modeId: null }]);
    expect((await getCashPurchaseForEdit(none.id)).payments).toEqual([]);
  });

  it("refuses a category that isn't one of this organization's purchase categories", async () => {
    const foreign = await acct(other.tenantId, "5000");
    await expect(createCashPurchase(purchase({ lines: [{ description: "x", categoryId: foreign.id, rate: 50, quantity: 2, discount: 0 }] }))).rejects.toThrow(/valid purchase category/);
  });

  it("numbers bills without a supplier number without clashing", async () => {
    const already = (await bills()).filter((b) => b.billNumber.startsWith("AUTO-")).length; // stockable invoices without a number get these too
    await createCashPurchase(purchase());
    await createCashPurchase(purchase());
    const autos = (await bills()).filter((b) => b.billNumber.startsWith("AUTO-")).map((b) => b.billNumber);
    expect(new Set(autos).size).toBe(autos.length);
    expect(autos.length).toBe(already + 2);
  });

  it("one bill can carry several lines booked to different categories, and is editable with its lines", async () => {
    const cogs = await acct(org.tenantId, "5000");
    const second = (await createSubAccount(org.tenantId, cogs, "Cleaning")).id;
    await createCashPurchase(
      purchase({
        billNumber: "MULTI-1",
        vendorId: vendorA,
        billType: "vat" as const,
        billAvailable: false,
        lines: [
          { description: "Paper", categoryId, rate: 100, quantity: 1, discount: 0 },
          { description: "Mop", categoryId: second, rate: 200, quantity: 1, discount: 0 },
        ],
        payments: [{ accountId: cashId, amount: 339 }], // 300 + 13% VAT
      })
    );
    const bill = (await bills()).find((b) => b.billNumber === "MULTI-1")!;
    expect(Number(bill.total)).toBe(339);
    expect(bill.description).toBe("Paper, Mop");
    expect(bill.billAvailable).toBe(false);
    // each category got its own line (VAT is registered in this org by now, so it is claimed separately)
    const edit = await getCashPurchaseForEdit(bill.id);
    expect(edit.lines.map((l) => [l.description, l.categoryId])).toEqual([["Paper", categoryId], ["Mop", second]]);

    await updateCashPurchase({
      billId: bill.id,
      billNumber: "MULTI-1",
      billDate: "2026-09-08",
      vendorId: vendorA,
      billType: "no_bill",
      lines: [{ description: "Mop", categoryId: second, rate: 200, quantity: 1, discount: 0 }],
      payments: [{ accountId: cashId, amount: 200 }],
    });
    expect(Number((await bills()).find((b) => b.id === bill.id)!.total)).toBe(200);
  });
});
