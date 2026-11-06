import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, inventorySettings, items, journalEntries, journalLines, salesInvoices, stockMovements, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";

// An organization that does not keep stock: sales and sales returns leave stock and cost of goods sold alone, and nothing that needs stock goes through.
let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createItem } = await import("./items/actions");
const { adjustStock } = await import("./stock/actions");
const { createPurchaseInvoice } = await import("../purchases/actions");
const { createSingleInvoice, voidInvoice } = await import("../sales/actions");
const { createSalesReturn } = await import("../return/sales/actions");
const { createPurchaseReturn } = await import("../return/purchase/actions");

vi.setConfig({ testTimeout: 300_000 });

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100 + 0;
}
const stock = async (id: string) => Number((await db.select().from(items).where(eq(items.id, id)))[0].stockQuantity);
const movements = async () => (await db.select().from(stockMovements).where(eq(stockMovements.tenantId, org.tenantId))).length;
const track = (value: boolean) => db.insert(inventorySettings).values({ tenantId: org.tenantId, trackInventory: value }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: { trackInventory: value } });
const line = (itemId: string, rate: number, quantity: number) => ({ itemId, description: "x", rate, quantity, discount: 0 });
const fd = (id: string) => Object.assign(new FormData(), { get: () => id }) as unknown as FormData;

let vendorId: string;
let customerId: string;
let widget: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ No inventory");
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
  customerId = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer" }).returning())[0].id;
  widget = (await createItem({ name: "Widget", purchasePrice: 0, sellingPrice: 0, unitId: "", categoryId: "" })).id;
});
afterAll(async () => {
  await org.remove();
});

describe("selling without keeping stock", () => {
  let earlySale: string;

  it("while stock is kept, a purchase and a sale work as always (the starting point)", async () => {
    await createPurchaseInvoice({ invoiceNumber: "P-1", invoiceDate: "2026-09-01", vendorId, billType: "no_bill", lines: [line(widget, 50, 10)], payments: [] });
    await createSingleInvoice({ invoiceNumber: "S-1", invoiceDate: "2026-09-02", customerId, lines: [line(widget, 100, 2)], payments: [] });
    earlySale = (await db.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, org.tenantId), eq(salesInvoices.invoiceNumber, "S-1"))))[0].id;
    expect(await stock(widget)).toBe(8);
    expect(await balance("5000")).toBe(100); // 2 units at 50
  });

  it("a sale beyond the stock on hand goes through, and moves no stock and posts no cost of goods sold", async () => {
    await track(false);
    const before = { moves: await movements(), cogs: await balance("5000"), inventory: await balance("1200") };
    await createSingleInvoice({ invoiceNumber: "S-2", invoiceDate: "2026-09-03", customerId, lines: [line(widget, 100, 25)], payments: [] }); // only 8 on hand
    expect(await movements()).toBe(before.moves);
    expect(await stock(widget)).toBe(8);
    expect(await balance("5000")).toBe(before.cogs);
    expect(await balance("1200")).toBe(before.inventory);
    expect(await balance("4000")).toBe(-(200 + 2500)); // the revenue is still booked
  });

  it("a sales return moves no stock and credits no cost of goods sold", async () => {
    const cogs = await balance("5000");
    const moves = await movements();
    await createSalesReturn({ noteNumber: "DN-1", noteDate: "2026-09-04", customerId, lines: [line(widget, 100, 3)] });
    expect(await movements()).toBe(moves);
    expect(await balance("5000")).toBe(cogs);
  });

  it("nothing that needs stock goes through: a purchase with items, a return of stocked goods, an adjustment", async () => {
    await expect(createPurchaseInvoice({ invoiceNumber: "P-2", invoiceDate: "2026-09-05", vendorId, billType: "no_bill", lines: [line(widget, 50, 5)], payments: [] })).rejects.toThrow(/need inventory tracking/);
    await expect(createPurchaseReturn({ noteNumber: "CN-1", noteDate: "2026-09-05", vendorId, withVat: false, lines: [line(widget, 50, 1)] })).rejects.toThrow(/need inventory tracking/);
    await expect(adjustStock({ itemId: widget, quantityChange: 5, unitCost: 50, date: "2026-09-05", reason: "count" })).rejects.toThrow(/tracking is turned off/);
  });

  it("a sale made while stock was kept can still be voided: its stock comes back and its cost is reversed", async () => {
    const f = fd(earlySale);
    await voidInvoice(f);
    expect(await stock(widget)).toBe(10);
    expect(await balance("5000")).toBe(0);
  });

  it("turning tracking back on restores the stock rules: a sale beyond the stock is refused again", async () => {
    await track(true);
    await expect(createSingleInvoice({ invoiceNumber: "S-3", invoiceDate: "2026-09-06", customerId, lines: [line(widget, 100, 50)], payments: [] })).rejects.toThrow(/in stock/);
  });
});
