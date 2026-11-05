import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, inventorySettings, journalEntries, journalLines, purchaseBills, stockMovements } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getOrCreatePurchasesAccount, getPurchaseCategories } from "@/lib/ledger/purchases-accounts";
import { getCogsSubGroups } from "@/lib/ledger/control-accounts";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { recordAmountPurchases, updateCashPurchase, voidBill } = await import("./actions");

vi.setConfig({ testTimeout: 240_000 });

const cashId = async () => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
const balanceOf = async (accountId: string) => {
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, accountId)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100; // debit balance
};
let purchasesId: string;
const row = (over: Partial<Parameters<typeof recordAmountPurchases>[0]["rows"][number]> = {}) => ({ billDate: "2026-10-05", vendorId: "", billNumber: "", billType: "no_bill" as const, categoryId: purchasesId, description: "", amount: 1000, discount: 0, payments: [], ...over });

beforeAll(async () => {
  org = await createTempOrg("ZZ Amount purchases");
  purchasesId = (await getOrCreatePurchasesAccount(org.tenantId)).id;
});
afterAll(async () => {
  await org.remove();
});

describe("purchases recorded by amount only", () => {
  it("are refused while the organization keeps stock", async () => {
    await expect(recordAmountPurchases({ rows: [row({ payments: [{ accountId: await cashId(), amount: 1000 }] })] })).rejects.toThrow(/keeps stock/);
  });

  it("book the amount to Purchases, outside Cost of Goods Sold, without touching stock", async () => {
    await db.insert(inventorySettings).values({ tenantId: org.tenantId, trackInventory: false }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: { trackInventory: false } });
    const cash = await cashId();
    // an unpaid bill needs a supplier, and the check says which row; nothing is saved when any row fails the check
    await expect(recordAmountPurchases({ rows: [row({ amount: 1000, payments: [{ accountId: cash, amount: 1000 }] }), row({ billNumber: "X", amount: 2500 })] })).rejects.toThrow(/Row 2: .*supplier/i);
    expect(await db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId))).toHaveLength(0);
    const ok = await recordAmountPurchases({ rows: [row({ amount: 1000, payments: [{ accountId: cash, amount: 1000 }] }), row({ billDate: "2026-10-06", amount: 400, payments: [{ accountId: cash, amount: 400 }], description: "Packing" })] });
    expect(ok).toEqual({ ok: true, saved: 2 });
    expect(await balanceOf(purchasesId)).toBe(1400);
    expect(await balanceOf(cash)).toBe(-1400);
    // no stock moved and nothing went to COGS
    expect(await db.select().from(stockMovements).where(eq(stockMovements.tenantId, org.tenantId))).toHaveLength(0);
    for (const c of await getCogsSubGroups(org.tenantId)) expect(await balanceOf(c.id)).toBe(0);
    const bills = await db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId));
    expect(bills.map((b) => [b.purchaseType, b.status, Number(b.total)]).sort()).toEqual([["cash", "paid", 1000], ["cash", "paid", 400]]);
  });

  it("only accepts the Purchases account, its sub-accounts or a COGS sub-group as the category", async () => {
    const cash = await cashId();
    const rent = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "5100"))))[0];
    await expect(recordAmountPurchases({ rows: [row({ categoryId: rent.id, payments: [{ accountId: cash, amount: 1000 }] })] })).rejects.toThrow(/category/i);
    expect((await getPurchaseCategories(org.tenantId)).map((c) => c.name)).toEqual(["Purchases"]);
  });

  it("can be edited and voided like any other bill, and the Purchases balance follows", async () => {
    const cash = await cashId();
    const [bill] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.total, "1000.00")));
    await updateCashPurchase({ billId: bill.id, billNumber: bill.billNumber, billDate: "2026-10-05", vendorId: "", billType: "no_bill", lines: [{ description: "", categoryId: purchasesId, rate: 1200, quantity: 1, discount: 0 }], payments: [{ accountId: cash, amount: 1200 }] });
    expect(await balanceOf(purchasesId)).toBe(1600);
    const fd = new FormData();
    fd.set("billId", bill.id);
    await voidBill(fd);
    expect(await balanceOf(purchasesId)).toBe(400);
  });
});
