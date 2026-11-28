import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceObligations, inventorySettings, purchaseBills } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getOrCreatePurchasesAccount } from "@/lib/ledger/purchases-accounts";
import { getVatReturn } from "@/lib/compliance/reports";
import { getVatPeriodDetails } from "@/lib/compliance/vat-period-details";
import { keepFiledNetPurchase } from "@/lib/compliance/vat-worksheet";
import type { VatWorksheetFigures } from "@/db/schema/vat-worksheet";

// A VAT bill can carry taxable and exempt goods together. Only what carried VAT counts as net purchase; exempt, zero-rated and purchases not on a VAT bill are
// shown beside it. A period already filed keeps the net purchase it was saved with.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let org: Awaited<ReturnType<typeof createTempOrg>>;
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));
const { createCashPurchase, getCashPurchaseForEdit, recordAmountPurchases, recordPendingPurchases } = await import("./actions");

let cashId: string;
let categoryId: string;
const billBy = async (number: string) => (await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, number))))[0];
const tracking = (trackInventory: boolean) => db.insert(inventorySettings).values({ tenantId: org.tenantId, trackInventory }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: { trackInventory } });
const row = (over: Partial<Parameters<typeof recordAmountPurchases>[0]["rows"][number]>) => ({ billDate: "2026-10-05", vendorId: "", billNumber: "", billType: "vat" as const, categoryId, description: "", amount: 0, discount: 0, payments: [], ...over });
const paid = (amount: number) => [{ accountId: cashId, amount }];
const split = async () => (await getVatReturn(org.tenantId, "2026-10-01", "2026-10-31")).purchaseSplit;

beforeAll(async () => {
  org = await createTempOrg("ZZ Mixed VAT");
  cashId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
  categoryId = (await getOrCreatePurchasesAccount(org.tenantId)).id;
  await tracking(false);
});
afterAll(async () => {
  await org.remove();
});

describe("a bill with taxable and exempt goods together", () => {
  it("charges VAT only on the taxable line, and opens again with each line's choice", async () => {
    const { billNumber } = await createCashPurchase({
      billNumber: "MIX-1", billDate: "2026-10-02", vendorId: "", billType: "vat", payments: paid(13300),
      lines: [{ description: "A", categoryId, rate: 1000, quantity: 10, discount: 0 }, { description: "B", categoryId, rate: 500, quantity: 4, discount: 0, taxTreatment: "exempt" }],
    });
    const bill = await billBy(billNumber);
    expect([Number(bill.subtotal), Number(bill.taxAmount), Number(bill.total)]).toEqual([12000, 1300, 13300]);
    expect((await getCashPurchaseForEdit(bill.id)).lines.map((l) => l.taxTreatment)).toEqual([undefined, "exempt"]);
    expect(await split()).toEqual({ taxable: 10000, zeroRated: 0, exempt: 2000, noVatBill: 0 });
  });

  it("can be recorded by amount in two parts, and a bill without VAT stays out of net purchase", async () => {
    const done = await recordAmountPurchases({ rows: [row({ billNumber: "AMT-1", amount: 1000, nonTaxable: 300, payments: paid(1430) }), row({ billNumber: "AMT-2", billType: "pan", amount: 5000, nonTaxable: 999, payments: paid(5000) })] });
    expect(done).toEqual({ ok: true, saved: 2 });
    expect([Number((await billBy("AMT-1")).taxAmount), Number((await billBy("AMT-1")).total)]).toEqual([130, 1430]);
    expect(Number((await billBy("AMT-2")).total)).toBe(5000); // the non-taxable amount means nothing without a VAT bill
    expect(await split()).toEqual({ taxable: 11000, zeroRated: 0, exempt: 2300, noVatBill: 5000 });
  });

  it("takes a VAT bill that is wholly non-taxable", async () => {
    expect(await recordAmountPurchases({ rows: [row({ billNumber: "AMT-3", amount: 0, nonTaxable: 700, payments: paid(700) })] })).toEqual({ ok: true, saved: 1 });
    expect(await split()).toEqual({ taxable: 11000, zeroRated: 0, exempt: 3000, noVatBill: 5000 });
  });

  it("keeps the exempt part of a purchase whose items are still to be added", async () => {
    await tracking(true);
    expect(await recordPendingPurchases({ rows: [row({ billNumber: "PEND-1", amount: 2000, nonTaxable: 500, payments: paid(2760) })] })).toEqual({ ok: true, saved: 1 });
    expect(Number((await billBy("PEND-1")).pendingExemptAmount)).toBe(500);
    expect(await split()).toEqual({ taxable: 13000, zeroRated: 0, exempt: 3500, noVatBill: 5000 });
    await tracking(false);
  });

  it("lists the documents behind each part, adding up to the figures", async () => {
    const details = await getVatPeriodDetails(org.tenantId, "2026-10-01", "2026-10-31");
    expect(details.purchasesTaxable).toBe(13000);
    expect(Object.fromEntries(details.otherPurchases.map((o) => [o.key, [o.total, o.lines.length]]))).toEqual({ exempt: [3500, 4], zeroRated: [0, 0], noVatBill: [5000, 1] });
  });
});

describe("loading the worksheet again", () => {
  it("keeps the net purchase a filed period was saved with, and works out the others afresh", async () => {
    const make = async (label: string, status: "filed" | "pending", from: string, to: string) =>
      (await db.insert(complianceObligations).values({ tenantId: org.tenantId, categoryKey: "tax", taxTypeKey: "vat", name: "VAT", periodLabel: label, periodStart: from, periodEnd: to, dueDate: to, status } as never).returning())[0].id;
    const filed = await make("Aug", "filed", "2026-08-01", "2026-08-31");
    const open = await make("Sep", "pending", "2026-09-01", "2026-09-30");
    const period = (obligationId: string, netPurchase: number) => ({ obligationId, periodLabel: "x", periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-09-25", netSales: 0, salesVat: 0, netPurchase, purchaseVat: 130 });
    const saved: VatWorksheetFigures = { openingCredit: 0, earlierPayable: [], periods: [period(filed, 17000), period(open, 17000)] };
    const fresh: VatWorksheetFigures = { openingCredit: 0, earlierPayable: [], periods: [period(filed, 1000), period(open, 1000)] };
    expect((await keepFiledNetPurchase(org.tenantId, fresh, saved)).periods.map((p) => p.netPurchase)).toEqual([17000, 1000]);
    expect((await keepFiledNetPurchase(org.tenantId, fresh, null)).periods.map((p) => p.netPurchase)).toEqual([1000, 1000]);
  });
});
