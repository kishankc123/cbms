import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetCategories, assetEvents, assets, journalEntries, journalLines, paymentAllocations, payments, purchaseBills, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { getSupplierLines } from "@/lib/ledger/supplier-balances";
import { lineKind } from "@/lib/ledger/party-statement";
import { recordAssetPurchase, voidAssetPurchase, type AssetPurchaseInput } from "./purchase";
import { ensureAssetSetup } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let vendorA: string;
let vendorB: string;
let cashId: string;
let categoryId: string;
let rate: number;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0) * 100) / 100;
}
const countAssets = async () => (await db.select().from(assets).where(eq(assets.tenantId, org.tenantId))).length;
const countBills = async () => (await db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId))).length;

const purchase = (over: Partial<AssetPurchaseInput> = {}): AssetPurchaseInput => ({
  name: "Dell laptop",
  categoryId,
  purchaseDate: "2026-09-10",
  availableForUseDate: "2026-09-12",
  vendorId: vendorA,
  invoiceNumber: "",
  billType: "vat",
  purchasePrice: 100000,
  freightCost: 0,
  installationCost: 0,
  otherCost: 0,
  method: "straight_line",
  usefulLifeMonths: 48,
  residualValue: 0,
  depreciationStartDate: null,
  payments: [{ accountId: cashId, amount: 0 }],
  ...over,
});
const withPay = (amount: number) => ({ payments: [{ accountId: cashId, amount }] });

beforeAll(async () => {
  org = await createTempOrg("ZZ Asset Purchase");
  await ensureAssetSetup(org.tenantId);
  [{ id: vendorA }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier A" }).returning({ id: vendors.id });
  [{ id: vendorB }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier B" }).returning({ id: vendors.id });
  cashId = (await acct("1000")).id;
  categoryId = (await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId)))[0].id;
  rate = await getTaxRate(org.tenantId, "vat", "2026-09-10");
});
afterAll(async () => {
  await org.remove();
});

describe("asset purchase", () => {
  it("without a VAT registration the VAT can't be claimed, so it is part of the asset's cost", async () => {
    expect(rate).toBeGreaterThan(0);
    const vat = Math.round(100000 * (rate / 100) * 100) / 100;
    const r = await recordAssetPurchase(org.tenantId, org.userId, purchase(withPay(100000 + vat)));
    expect(r).toMatchObject({ ok: true, assetCode: "FA-000001" });
    if (!r.ok) return;

    const [asset] = await db.select().from(assets).where(eq(assets.id, r.assetId));
    expect(asset).toMatchObject({ status: "active", source: "purchase", name: "Dell laptop", depreciationMethod: "straight_line", usefulLifeMonths: 48 });
    expect(Number(asset.capitalizedCost)).toBe(100000 + vat);
    expect(Number(asset.vatAmount)).toBe(vat);
    expect(asset.depreciationStartDate).toBe("2026-09-12"); // the available-for-use date, not the purchase date

    const [bill] = await db.select().from(purchaseBills).where(eq(purchaseBills.id, r.billId));
    expect(bill).toMatchObject({ purchaseType: "asset", status: "paid", vendorId: vendorA });
    expect(Number(bill.total)).toBe(100000 + vat);
    expect(asset.purchaseBillId).toBe(r.billId);

    expect(await balance("1500")).toBe(100000 + vat); // Fixed Assets
    expect(await balance("1000")).toBe(-(100000 + vat)); // paid from cash
    expect(await balance("1300")).toBe(0); // no Tax Receivable

    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, r.billId)));
    expect(entry.sourceType).toBe("asset_purchase");

    const events = await db.select().from(assetEvents).where(eq(assetEvents.assetId, r.assetId));
    expect(events.map((e) => e.eventType).sort()).toEqual(["available_for_use", "purchased"]);
    expect(events.find((e) => e.eventType === "purchased")!.journalEntryId).toBe(entry.id);
    expect((await db.select().from(payments).where(eq(payments.tenantId, org.tenantId))).length).toBe(1);
  });

  it("with a VAT registration the VAT is claimed (Tax Receivable) and stays out of the cost", async () => {
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    const vat = Math.round(200000 * (rate / 100) * 100) / 100;
    const before1500 = await balance("1500");
    const r = await recordAssetPurchase(org.tenantId, org.userId, purchase({ name: "Server", invoiceNumber: "INV-77", purchasePrice: 200000, ...withPay(200000 + vat) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [asset] = await db.select().from(assets).where(eq(assets.id, r.assetId));
    expect(Number(asset.capitalizedCost)).toBe(200000);
    expect(asset.assetCode).toBe("FA-000002");
    expect((await balance("1500")) - before1500).toBe(200000);
    expect(await balance("1300")).toBe(vat);
  });

  it("an unpaid or part-paid purchase is owed to the supplier, and the bill status says so", async () => {
    const unpaid = await recordAssetPurchase(org.tenantId, org.userId, purchase({ name: "Printer", purchasePrice: 50000, billType: "no_bill", payments: [] }));
    const part = await recordAssetPurchase(org.tenantId, org.userId, purchase({ name: "Scanner", purchasePrice: 40000, billType: "no_bill", vendorId: vendorB, ...withPay(10000) }));
    expect(unpaid.ok && part.ok).toBe(true);
    if (!unpaid.ok || !part.ok) return;
    expect((await db.select().from(purchaseBills).where(eq(purchaseBills.id, unpaid.billId)))[0]).toMatchObject({ status: "open", amountPaid: "0.00" });
    expect((await db.select().from(purchaseBills).where(eq(purchaseBills.id, part.billId)))[0]).toMatchObject({ status: "partially_paid", amountPaid: "10000.00" });

    const lines = await getSupplierLines(org.tenantId);
    const b = lines.get(vendorB)!;
    expect(b.some((l) => l.sourceType === "asset_purchase" && lineKind(l.sourceType) === "invoice" && l.credit === 30000)).toBe(true);
  });

  it("refuses bad input with a readable message and saves nothing", async () => {
    const assetsBefore = await countAssets();
    const billsBefore = await countBills();
    const cases: [Partial<AssetPurchaseInput>, RegExp][] = [
      [{ name: "  " }, /asset name/i],
      [{ vendorId: "" }, /supplier/i],
      [{ purchasePrice: 0 }, /purchase price/i],
      [{ availableForUseDate: "2026-09-01" }, /before the purchase date/i],
      [{ method: "straight_line", usefulLifeMonths: null }, /useful life/i],
      [{ residualValue: 999999999 }, /residual/i],
      [{ purchasePrice: 1000, billType: "no_bill", payments: [{ accountId: cashId, amount: 5000 }] }, /can't exceed/i],
    ];
    for (const [over, pattern] of cases) {
      const r = await recordAssetPurchase(org.tenantId, org.userId, purchase(over));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toMatch(pattern);
    }
    // the same supplier can't use the same invoice number twice
    const dup = await recordAssetPurchase(org.tenantId, org.userId, purchase({ invoiceNumber: "INV-77", billType: "no_bill" }));
    expect(dup).toMatchObject({ ok: false });
    expect((dup as { error: string }).error).toMatch(/already recorded/);
    // a hand-typed asset code can't clash with an existing one
    const clash = await recordAssetPurchase(org.tenantId, org.userId, purchase({ assetCode: "FA-000001", billType: "no_bill" }));
    expect((clash as { error: string }).error).toMatch(/already used/);

    expect(await countAssets()).toBe(assetsBefore);
    expect(await countBills()).toBe(billsBefore);
  });

  it("a mistaken purchase can be voided before depreciation, and not after", async () => {
    const r = await recordAssetPurchase(org.tenantId, org.userId, purchase({ name: "Mistake", purchasePrice: 10000, billType: "no_bill", ...withPay(10000) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cashBefore = await balance("1000");
    const fixedBefore = await balance("1500");

    const voided = await voidAssetPurchase(org.tenantId, org.userId, r.assetId);
    expect(voided).toEqual({ ok: true });
    expect((await db.select().from(assets).where(eq(assets.id, r.assetId)))[0].status).toBe("voided");
    expect((await db.select().from(purchaseBills).where(eq(purchaseBills.id, r.billId)))[0].status).toBe("void");
    expect(await balance("1000")).toBe(cashBefore + 10000);
    expect(await balance("1500")).toBe(fixedBefore - 10000);
    expect(await voidAssetPurchase(org.tenantId, org.userId, r.assetId)).toMatchObject({ ok: false });

    const two = await recordAssetPurchase(org.tenantId, org.userId, purchase({ name: "Depreciated", purchasePrice: 10000, billType: "no_bill", ...withPay(10000) }));
    if (!two.ok) throw new Error("setup failed");
    await db.update(assets).set({ lastDepreciationDate: "2026-09-30" }).where(eq(assets.id, two.assetId));
    const blocked = await voidAssetPurchase(org.tenantId, org.userId, two.assetId);
    expect(blocked).toMatchObject({ ok: false });
    expect((blocked as { error: string }).error).toMatch(/depreciation/i);
  });

  it("can't be voided under a payment made later in Payments", async () => {
    const r = await recordAssetPurchase(org.tenantId, org.userId, purchase({ name: "Unpaid chair", purchasePrice: 8000, billType: "no_bill", payments: [] }));
    if (!r.ok) throw new Error("setup failed");
    const [p] = await db
      .insert(payments)
      .values({ tenantId: org.tenantId, paymentNumber: "MO-ASSET-1", direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-20", partyType: "supplier", vendorId: vendorA, accountId: cashId, amount: "1000.00", createdBy: org.userId })
      .returning();
    await db.insert(paymentAllocations).values({ paymentId: p.id, targetType: "purchase_bill", targetId: r.billId, allocatedAmount: "1000.00" });
    const blocked = await voidAssetPurchase(org.tenantId, org.userId, r.assetId);
    expect(blocked).toMatchObject({ ok: false });
    expect((blocked as { error: string }).error).toMatch(/MO-ASSET-1/);
  });
});
