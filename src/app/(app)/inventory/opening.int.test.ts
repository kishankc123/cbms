import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, items, journalEntries, journalLines, purchaseBills, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getInventoryValuation } from "@/lib/inventory/valuation";
import { getInventoryHistory, getOpeningRows } from "@/lib/inventory/opening";
import { recalculateAll, verifyStockBalances } from "@/lib/inventory/recalc";

// Every document here also re-costs history, so the steps are slower than the other tests.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createItem } = await import("./items/actions");
const { adjustStock } = await import("./stock/actions");
const { changeInventoryOpeningDate, deleteOpeningStock, previewInventoryOpeningDate, previewOpeningStockChange, saveOpeningStock } = await import("./stock/opening-actions");
const { createPurchaseInvoice, voidBill } = await import("../purchases/actions");
const { createSingleInvoice } = await import("../sales/actions");

async function balance(code: string) {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code)));
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100 + 0;
}
const itemRow = async (id: string) => (await db.select().from(items).where(eq(items.id, id)))[0];
const line = (itemId: string, rate: number, quantity: number) => ({ itemId, description: "x", rate, quantity, discount: 0 });
const base = { purchasePrice: 0, sellingPrice: 0, unitId: "", categoryId: "" };

let vendorId: string;
let customerId: string;
let a: string; // Product A

beforeAll(async () => {
  org = await createTempOrg("ZZ Opening Test");
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
  customerId = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer" }).returning())[0].id;
  a = (await createItem({ ...base, name: "Product A" })).id;
});
afterAll(async () => {
  await org.remove();
});

describe("the Inventory Opening Date", () => {
  it("can't be set while stock movements are dated before it, and says which", async () => {
    await createPurchaseInvoice({ invoiceNumber: "P-OLD", invoiceDate: "2026-08-20", vendorId, billType: "no_bill", lines: [line(a, 100, 1)], payments: [] }); // no date yet: no limit
    const preview = await previewInventoryOpeningDate("2026-09-01");
    expect(preview.blockerCount).toBe(1);
    expect(preview.blockers[0].document).toMatch(/P-OLD/);
    await expect(changeInventoryOpeningDate({ date: "2026-09-01", confirmed: true })).rejects.toThrow(/before/);

    const bill = (await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, "P-OLD"))))[0];
    await voidBill(Object.assign(new FormData(), { get: () => bill.id }) as unknown as FormData);
    await expect(changeInventoryOpeningDate({ date: "2026-09-01", confirmed: false })).rejects.toThrow(/confirm/);
    await changeInventoryOpeningDate({ date: "2026-09-01", confirmed: true });
  });

  it("refuses documents and adjustments dated before it, and doesn't touch anything", async () => {
    await expect(createPurchaseInvoice({ invoiceNumber: "P-EARLY", invoiceDate: "2026-08-31", vendorId, billType: "no_bill", lines: [line(a, 100, 1)], payments: [] })).rejects.toThrow(/before the Inventory Opening Date/);
    await expect(createSingleInvoice({ invoiceNumber: "S-EARLY", invoiceDate: "2026-08-31", customerId, lines: [line(a, 100, 1)], payments: [] })).rejects.toThrow(/before the Inventory Opening Date/);
    await expect(adjustStock({ itemId: a, quantityChange: 1, date: "2026-08-31", reason: "x" })).rejects.toThrow(/before the Inventory Opening Date/);
    expect((await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, "P-EARLY")))).length).toBe(0);
  });
});

describe("opening stock, then editing it (Product A)", () => {
  it("opening 20 @ 250 is a starting balance against Brought forward, not a purchase; then a purchase and a sale after it", async () => {
    await saveOpeningStock({ itemId: a, quantity: 20, unitCost: 250 });
    expect(await balance("1200")).toBe(5000);
    expect(await balance("3200")).toBe(-5000);
    expect((await db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId))).filter((b) => b.status !== "void").length).toBe(0);

    await createPurchaseInvoice({ invoiceNumber: "P-1", invoiceDate: "2026-09-10", vendorId, billType: "no_bill", lines: [line(a, 300, 10)], payments: [] });
    await createSingleInvoice({ invoiceNumber: "S-1", invoiceDate: "2026-09-15", customerId, lines: [line(a, 500, 10)], payments: [] });
    expect(await balance("5000")).toBe(2666.67);
    expect(await balance("1200")).toBe(5333.33);
  });

  it("editing the opening to 25 @ 250 re-costs the later sale, keeps the original in the history, and the books stay equal", async () => {
    const preview = await previewOpeningStockChange({ itemId: a, quantity: 25, unitCost: 250 });
    expect(preview.blocked).toBeNull();
    expect(preview.affected.length).toBe(1);
    expect(preview.affected[0].to).toBe(2642.86);
    expect(preview.costOfGoodsSoldChange).toBe(-23.81);

    await saveOpeningStock({ itemId: a, quantity: 25, unitCost: 250, reason: "Counted wrongly at the start" });
    const w = await itemRow(a);
    expect(Number(w.stockQuantity)).toBe(25);
    expect(Number(w.stockValue)).toBe(6607.14); // 6,250 + 3,000 - 2,642.86
    expect(await balance("1200")).toBe(6607.14);
    expect(await balance("5000")).toBe(2642.86);
    expect(await balance("3200")).toBe(-6250);

    const history = await getInventoryHistory(org.tenantId);
    const edit = history.find((h) => h.action === "inventory_opening_edited")!;
    expect((edit.before as { quantity: number }).quantity).toBe(20);
    expect((edit.after as { quantity: number }).quantity).toBe(25);
    expect(edit.reason).toBe("Counted wrongly at the start");
    expect(history.some((h) => h.action === "inventory_opening_created")).toBe(true);
    expect(history.some((h) => h.action === "inventory_recosted")).toBe(true);
    expect((await getOpeningRows(org.tenantId)).length).toBe(1);
    expect((await getInventoryValuation(org.tenantId)).difference).toBe(0);
  });

  it("a purchase entered later but dated 12 Sep re-costs the 15 Sep sale to the earlier average", async () => {
    await createPurchaseInvoice({ invoiceNumber: "P-LATE", invoiceDate: "2026-09-12", vendorId, billType: "no_bill", lines: [line(a, 200, 10)], payments: [] });
    const w = await itemRow(a);
    expect(Number(w.stockQuantity)).toBe(35);
    expect(Number(w.stockValue)).toBe(8750); // 6,250 + 3,000 + 2,000 - 2,500
    expect(await balance("5000")).toBe(2500); // 10,000 / 40 per unit
    expect(await balance("1200")).toBe(8750);
    expect((await getInventoryValuation(org.tenantId)).difference).toBe(0);
  });

  it("refuses to shrink or delete opening stock that later sales need (stock would go negative)", async () => {
    await createSingleInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-20", customerId, lines: [line(a, 500, 30)], payments: [] });
    const p = await previewOpeningStockChange({ itemId: a, quantity: 10, unitCost: 250 });
    expect(p.blocked).toMatch(/drop to/);
    await expect(saveOpeningStock({ itemId: a, quantity: 10, unitCost: 250 })).rejects.toThrow(/drop to/);
    await expect(deleteOpeningStock({ itemId: a })).rejects.toThrow(/drop to/);
    expect(Number((await itemRow(a)).stockQuantity)).toBe(5); // nothing changed
    await saveOpeningStock({ itemId: a, quantity: 30, unitCost: 250 }); // more is fine
    expect(Number((await itemRow(a)).stockQuantity)).toBe(10);
  });
});

describe("moving the opening date, and keeping the balances honest", () => {
  it("moves opening balances (and their entries) to an earlier date; a later date is refused while documents sit between", async () => {
    await expect(changeInventoryOpeningDate({ date: "2026-09-11", confirmed: true })).rejects.toThrow(/before/); // P-1 is dated 10 Sep
    await changeInventoryOpeningDate({ date: "2026-08-25", reason: "Books start earlier", confirmed: true });
    expect((await getOpeningRows(org.tenantId))[0].date).toBe("2026-08-25");
    const entries = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, "stock_adjustment"), eq(journalEntries.sourceId, a), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
    expect(entries.length).toBe(1);
    expect(entries[0].entryDate).toBe("2026-08-25");
    const history = await getInventoryHistory(org.tenantId);
    expect(history.find((h) => h.action === "inventory_opening_date_changed")?.reason).toBe("Books start earlier");
    await createPurchaseInvoice({ invoiceNumber: "P-OK", invoiceDate: "2026-08-31", vendorId, billType: "no_bill", lines: [line(a, 250, 1)], payments: [] }); // now allowed
  });

  it("the stored balances match the movements, and recalculating finds nothing left to correct", async () => {
    expect(await verifyStockBalances(org.tenantId)).toEqual([]);
    expect((await recalculateAll(org.tenantId, { userId: org.userId, reason: "test" })).changes).toBe(0);
    expect((await getInventoryValuation(org.tenantId)).difference).toBe(0);
  });
});
