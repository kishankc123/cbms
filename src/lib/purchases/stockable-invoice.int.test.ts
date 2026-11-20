import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, items, journalEntries, journalLines, purchaseBills, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createStockableInvoiceCore } from "./stockable-invoice";
import { buildItemTemplate, importItemBills, reviewItemFile, type ItemImportSettings } from "./import/item-service";

// A VAT bill that mixes taxable, zero-rated and exempt goods, and the same thing arriving through the item import.
let org: Awaited<ReturnType<typeof createTempOrg>>;
let vendorId: string;
let rice: string;
let salt: string;
let mask: string;
const ctx = () => ({ tenantId: org.tenantId, userId: org.userId });

const balance = async (code: string) => {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code)));
  if (!a) return 0;
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100;
};
const bill = async (n: string) => (await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, n))))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Mixed VAT purchases");
  await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Himal Traders" }).returning())[0].id;
  const mk = async (name: string, treatment: string) => (await db.insert(items).values({ tenantId: org.tenantId, name, inventoryTracking: true, purchaseVatTreatment: treatment }).returning())[0].id;
  rice = await mk("Rice", "taxable");
  salt = await mk("Salt", "zero_rated");
  mask = await mk("Mask", "exempt");
});
afterAll(async () => {
  await org.remove();
});

describe("a purchase invoice whose items are taxed differently", () => {
  it("charges VAT on the taxable lines only, and keeps the treatment of the others", async () => {
    await createStockableInvoiceCore(ctx(), {
      invoiceNumber: "MIX-1",
      invoiceDate: "2026-09-10",
      vendorId,
      billType: "vat",
      lines: [
        { itemId: rice, description: "Rice", rate: 100, quantity: 10, discount: 0 },
        { itemId: salt, description: "Salt", rate: 100, quantity: 4, discount: 0, taxTreatment: "zero_rated" },
        { itemId: mask, description: "Mask", rate: 50, quantity: 5, discount: 0, taxTreatment: "exempt" },
      ],
      payments: [],
    });
    const b = await bill("MIX-1");
    // 1,000 taxable + 400 zero-rated + 250 exempt; VAT is 13% of the 1,000 only.
    expect(Number(b.subtotal)).toBe(1650);
    expect(Number(b.taxAmount)).toBe(130);
    expect(Number(b.total)).toBe(1780);
    expect(b.lineItems.map((l) => l.taxTreatment)).toEqual([undefined, "zero_rated", "exempt"]);
    expect(await balance("1300")).toBe(130);
    expect(await balance("1200")).toBe(1650);
  });

  it("ignores the treatment on a bill that is not a VAT bill", async () => {
    await createStockableInvoiceCore(ctx(), {
      invoiceNumber: "PAN-1",
      invoiceDate: "2026-09-11",
      vendorId,
      billType: "pan",
      lines: [{ itemId: salt, description: "Salt", rate: 100, quantity: 2, discount: 0, taxTreatment: "zero_rated" }],
      payments: [],
    });
    const b = await bill("PAN-1");
    expect(Number(b.taxAmount)).toBe(0);
    expect(b.lineItems[0].taxTreatment).toBeUndefined();
  });
});

describe("importing purchases with their items", () => {
  const settings: ItemImportSettings = { defaultBillType: "vat", defaultAccountId: null, createSuppliers: true };
  const csv = [
    "Date,Supplier,Invoice no.,Bill type,Item,Quantity,Rate,Discount,VAT treatment,Paid,Account",
    "2026-09-12,Himal Traders,IMP-1,VAT,Rice,10,100,0,,,",
    // Salt is set to zero-rated on the item, and the cell is blank
    "2026-09-12,Himal Traders,IMP-1,VAT,Salt,2,100,0,,,",
    "2026-09-12,Annapurna Stores,IMP-2,VAT,Mask,3,50,0,Exempt,,",
    "2026-09-12,Himal Traders,IMP-3,VAT,Wheat flour,1,100,0,,,",
  ].join("\n");
  const base64 = Buffer.from(csv, "utf8").toString("base64");

  it("groups the lines into bills, uses each item's usual VAT treatment, and reports what is wrong", async () => {
    const r = await reviewItemFile(org.tenantId, base64, "p.csv", settings);
    expect(r.counts).toEqual({ ready: 2, problem: 1, duplicate: 0 });
    const one = r.bills.find((b) => b.invoiceNumber === "IMP-1")!;
    expect(one.lines.map((l) => l.treatment)).toEqual(["taxable", "zero_rated"]);
    expect(one.vat).toBe(130);
    expect(one.total).toBe(1330);
    expect(r.bills.find((b) => b.invoiceNumber === "IMP-2")).toMatchObject({ newSupplier: true, vat: 0, total: 150 });
    expect(r.bills.find((b) => b.invoiceNumber === "IMP-3")!.issues.join(" ")).toMatch(/not a stock item/);
  });

  it("posts the ready bills, creates the new supplier, and then sees them as already recorded", async () => {
    const r = await reviewItemFile(org.tenantId, base64, "p.csv", settings);
    const keys = r.bills.filter((b) => b.status === "ready").map((b) => b.key);
    expect(await importItemBills(ctx(), base64, "p.csv", settings, keys)).toEqual({ created: 2, failed: [] });
    expect((await db.select().from(vendors).where(eq(vendors.tenantId, org.tenantId))).map((v) => v.name).sort()).toEqual(["Annapurna Stores", "Himal Traders"]);
    expect(Number((await bill("IMP-1")).taxAmount)).toBe(130);
    const again = await reviewItemFile(org.tenantId, base64, "p.csv", settings);
    expect(again.counts).toMatchObject({ ready: 0, problem: 1, duplicate: 2 });
  });

  it("offers a template with the columns and the names to use", async () => {
    expect((await buildItemTemplate(org.tenantId)).length).toBeGreaterThan(100);
  });
});
