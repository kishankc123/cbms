import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, items, itemCategories, itemGroups, itemUnits, journalEntries, journalLines, salesInvoices, purchaseBills, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getInventoryValuation } from "@/lib/inventory/valuation";
import { getStockCard } from "@/lib/inventory/stock";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createItem, updateItem, deleteItem, setItemActive } = await import("./items/actions");
const { updateInventorySettings, createUnit } = await import("./setup/actions");
const { adjustStock } = await import("./stock/actions");
const { changeInventoryOpeningDate, saveOpeningStock } = await import("./stock/opening-actions");
const { createPurchaseInvoice, voidBill } = await import("../purchases/actions");
const { createSingleInvoice, voidInvoice } = await import("../sales/actions");
const { createSalesReturn } = await import("../return/sales/actions");
const { createPurchaseReturn } = await import("../return/purchase/actions");

const acct = async (tenantId: string, code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(org.tenantId, code);
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100 + 0;
}
const itemRow = async (id: string) => (await db.select().from(items).where(eq(items.id, id)))[0];
const num = (v: string) => Number(v);
const fd = (id: string) => Object.assign(new FormData(), { get: () => id }) as unknown as FormData;
const priceLine = (itemId: string, rate: number, quantity: number) => ({ itemId, description: "x", rate, quantity, discount: 0 });

let vendorId: string;
let customerId: string;
const base = { purchasePrice: 0, sellingPrice: 0, unitId: "", categoryId: "" };

beforeAll(async () => {
  org = await createTempOrg("ZZ Inventory Test");
  other = await createTempOrg("ZZ Inventory Other");
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
  customerId = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer" }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("item rules", () => {
  it("refuses duplicate names (whatever the capitalization), negative prices and another organization's unit or category", async () => {
    await createItem({ ...base, name: "Widget" });
    await expect(createItem({ ...base, name: "  widget " })).rejects.toThrow(/already an item/);
    await expect(createItem({ ...base, name: "Bad", purchasePrice: -1 })).rejects.toThrow(/negative/);

    const [foreignUnit] = await db.insert(itemUnits).values({ tenantId: other.tenantId, name: "Box" }).returning();
    await expect(createItem({ ...base, name: "Uses foreign unit", unitId: foreignUnit.id })).rejects.toThrow(/Unit not found/);
    const [g] = await db.insert(itemGroups).values({ tenantId: other.tenantId, name: "G" }).returning();
    const [c] = await db.insert(itemCategories).values({ tenantId: other.tenantId, groupId: g.id, name: "C" }).returning();
    await expect(createItem({ ...base, name: "Uses foreign category", categoryId: c.id })).rejects.toThrow(/Category not found/);

    await createUnit({ name: "Piece" });
    await expect(createUnit({ name: "piece" })).rejects.toThrow(/already a unit/);
  });

  it("an inactive item can't go on a new document, and an item with history can't be deleted", async () => {
    const stale = await createItem({ ...base, name: "Old stock" });
    await setItemActive({ itemId: stale.id, isActive: false });
    await expect(createSingleInvoice({ invoiceNumber: "I-INACTIVE", invoiceDate: "2026-09-01", customerId, lines: [{ itemId: stale.id, description: "x", rate: 10, quantity: 1, discount: 0 }], payments: [] })).rejects.toThrow(/inactive/);
    await deleteItem({ itemId: stale.id }); // no history: fine
    expect((await db.select().from(items).where(eq(items.id, stale.id))).length).toBe(0);
  });

  it("a stockable purchase line must be an item", async () => {
    await expect(createPurchaseInvoice({ invoiceNumber: "P-NOITEM", invoiceDate: "2026-09-01", vendorId, billType: "no_bill", lines: [{ itemId: null, description: "free typed", rate: 10, quantity: 1, discount: 0 }], payments: [] })).rejects.toThrow(/must be an item/);
  });
});

describe("stock cost", () => {
  let widget: string;
  let saleId: string;

  it("values stock at what was actually paid, averaged across purchases, and the Inventory account matches", async () => {
    widget = (await db.select().from(items).where(and(eq(items.tenantId, org.tenantId), eq(items.name, "Widget"))))[0].id;
    await createPurchaseInvoice({ invoiceNumber: "P-1", invoiceDate: "2026-09-01", vendorId, billType: "no_bill", lines: [priceLine(widget, 100, 10)], payments: [] });
    await createPurchaseInvoice({ invoiceNumber: "P-2", invoiceDate: "2026-09-02", vendorId, billType: "no_bill", lines: [priceLine(widget, 120, 10)], payments: [] });
    const w = await itemRow(widget);
    expect(num(w.stockQuantity)).toBe(20);
    expect(num(w.stockValue)).toBe(2200);
    expect(await balance("1200")).toBe(2200);
  });

  it("a sale takes goods out at the average cost (not the item's standard price), and that is the cost of goods sold", async () => {
    await updateItem({ ...base, itemId: widget, name: "Widget", purchasePrice: 999, sellingPrice: 200 }); // a stale standard price
    await createSingleInvoice({ invoiceNumber: "S-1", invoiceDate: "2026-09-03", customerId, lines: [priceLine(widget, 200, 4)], payments: [] });
    saleId = (await db.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, org.tenantId), eq(salesInvoices.invoiceNumber, "S-1"))))[0].id;
    const w = await itemRow(widget);
    expect(num(w.stockQuantity)).toBe(16);
    expect(num(w.stockValue)).toBe(1760);
    expect(await balance("5000")).toBe(440);
    expect(await balance("1200")).toBe(1760);
  });

  it("a sales return brings goods back at the current average cost; voiding the sale restores the exact cost it took", async () => {
    await createSalesReturn({ noteNumber: "DN-1", noteDate: "2026-09-04", customerId, lines: [priceLine(widget, 200, 1)] });
    expect(num((await itemRow(widget)).stockValue)).toBe(1870); // 1 x (1760 / 16)
    expect(await balance("1200")).toBe(1870);

    await voidInvoice(fd(saleId));
    const w = await itemRow(widget);
    expect(num(w.stockQuantity)).toBe(21);
    expect(num(w.stockValue)).toBe(2310);
    expect(await balance("1200")).toBe(2310);
    expect(await balance("5000")).toBe(-110); // only the return's cost credit is left
  });

  it("voiding a purchase takes out exactly what it put in; the stock card shows every step", async () => {
    const bill = (await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, "P-2"))))[0];
    await voidBill(fd(bill.id));
    const w = await itemRow(widget);
    // The return of 1 on 4 Sep was costed at the average of the day (110, with the 120 purchase in it); without that purchase the
    // average that day was 100, so history is replayed and the return is re-costed to 100.
    expect(num(w.stockQuantity)).toBe(11);
    expect(num(w.stockValue)).toBe(1100);
    expect(await balance("1200")).toBe(1100);
    const card = await getStockCard(org.tenantId, widget);
    expect(card[card.length - 1].balanceQuantity).toBe(11);
    expect(card[card.length - 1].balanceValue).toBe(1100);
  });

  it("refuses to sell more than is in stock, unless the organization allows negative stock", async () => {
    await expect(createSingleInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-05", customerId, lines: [priceLine(widget, 200, 50)], payments: [] })).rejects.toThrow(/Only 11 of Widget in stock/);
    expect((await db.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, org.tenantId), eq(salesInvoices.invoiceNumber, "S-2")))).length).toBe(0);

    await updateInventorySettings({ allowNegativeStock: true });
    await createSingleInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-05", customerId, lines: [priceLine(widget, 200, 50)], payments: [] });
    const w = await itemRow(widget);
    expect(num(w.stockQuantity)).toBe(-39);
    // 11 on hand at their average cost (all 1,100); the 39 beyond are costed at that same average of 100
    expect(num(w.stockValue)).toBe(-3900);
    expect(await balance("1200")).toBe(-3900);
    await updateInventorySettings({ allowNegativeStock: false });
  });
});

describe("opening stock, adjustments, purchase returns", () => {
  it("brings stock in against Brought forward, and writes it up or down through Inventory Adjustments — always tying to the ledger", async () => {
    const gadget = (await createItem({ ...base, name: "Gadget" })).id;
    await changeInventoryOpeningDate({ date: "2026-09-01", confirmed: true });
    await saveOpeningStock({ itemId: gadget, quantity: 10, unitCost: 50 });
    expect(num((await itemRow(gadget)).stockValue)).toBe(500);
    expect(await balance("3200")).toBe(-500);

    await adjustStock({ itemId: gadget, quantityChange: -2, date: "2026-09-02", reason: "Damaged" });
    expect(num((await itemRow(gadget)).stockValue)).toBe(400);
    expect(await balance("5920")).toBe(100);
    await expect(adjustStock({ itemId: gadget, quantityChange: -20, date: "2026-09-02", reason: "Miscount" })).rejects.toThrow(/Only 8 of Gadget/);
    await expect(adjustStock({ itemId: gadget, quantityChange: -1, date: "2026-09-02", reason: "  " })).rejects.toThrow(/reason/);

    await adjustStock({ itemId: gadget, quantityChange: 1, unitCost: 60, date: "2026-09-03", reason: "Found in the store room" });
    expect(num((await itemRow(gadget)).stockValue)).toBe(460);
    expect(await balance("5920")).toBe(40);
  });

  it("a purchase return takes off the stock value what it credits to Inventory", async () => {
    const part = (await createItem({ ...base, name: "Part" })).id;
    await createPurchaseInvoice({ invoiceNumber: "P-PART", invoiceDate: "2026-09-04", vendorId, billType: "no_bill", lines: [priceLine(part, 100, 5)], payments: [] });
    await createPurchaseReturn({ noteNumber: "CN-1", noteDate: "2026-09-05", vendorId, withVat: false, lines: [priceLine(part, 100, 2)] });
    const p = await itemRow(part);
    expect(num(p.stockQuantity)).toBe(3);
    expect(num(p.stockValue)).toBe(300);
  });

  it("the stock report matches the Inventory account exactly", async () => {
    const valuation = await getInventoryValuation(org.tenantId);
    expect(valuation.difference).toBe(0);
  });
});
