import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, inventorySettings, items, journalEntries, journalLines, purchaseBills, stockMovements, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { todayIso } from "@/lib/calendar";

// A stockable purchase recorded by its amount, with the items added later: the amount waits outside Inventory until the items are in.
let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createItem } = await import("../inventory/items/actions");
const { recordPendingPurchases, updatePurchaseInvoice, getPurchaseInvoiceForEdit, voidBill } = await import("./actions");
const { needsAttention } = await import("@/lib/dashboard/aggregates");

vi.setConfig({ testTimeout: 300_000 });

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  if (!a) return 0;
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100 + 0;
}
const bills = async () => db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId));
const billOf = async (n: string) => (await bills()).find((b) => b.billNumber === n)!;
const stock = async () => Number((await db.select().from(items).where(eq(items.id, widget)))[0].stockQuantity);
const moves = async () => (await db.select().from(stockMovements).where(eq(stockMovements.tenantId, org.tenantId))).length;
const row = (over: Record<string, unknown> = {}) => ({ billDate: "2026-10-05", vendorId: "", billNumber: "", billType: "no_bill" as const, categoryId: "", description: "", amount: 1000, discount: 0, payments: [] as { accountId: string; amount: number }[], ...over });
const fd = (id: string) => Object.assign(new FormData(), { get: () => id }) as unknown as FormData;

let vendorId: string;
let widget: string;
let cash: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Pending purchases");
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
  widget = (await createItem({ name: "Widget", purchasePrice: 0, sellingPrice: 0, unitId: "", categoryId: "" })).id;
  cash = (await acct("1000")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("purchases recorded by amount, items added later", () => {
  it("wait in their own account, outside Inventory, and move no stock", async () => {
    const r = await recordPendingPurchases({ rows: [row({ billNumber: "B-PAID", amount: 1000, payments: [{ accountId: cash, amount: 1000 }] }), row({ billNumber: "B-OWED", amount: 2500, vendorId })] });
    expect(r).toEqual({ ok: true, saved: 2 });
    expect(await balance("1210")).toBe(3500);
    expect(await balance("1200")).toBe(0);
    expect(await moves()).toBe(0);
    const b = await billOf("B-OWED");
    expect(b).toMatchObject({ purchaseType: "credit", detailsPending: true, status: "open" });
    expect(b.lineItems).toEqual([]);
    // it is flagged on the dashboard's Needs attention list, with how many and how much
    const items_ = await needsAttention(org.tenantId, todayIso());
    expect(items_.find((i) => i.id === "details_pending")).toMatchObject({ count: 2, amount: 3500 });
  });

  it("an unpaid one needs a supplier, and each row is checked before anything is saved", async () => {
    await expect(recordPendingPurchases({ rows: [row({ billNumber: "OK-1", payments: [{ accountId: cash, amount: 1000 }] }), row({ billNumber: "NO-SUP", amount: 400 })] })).rejects.toThrow(/Row 2: .*supplier/i);
    expect((await bills()).map((b) => b.billNumber).sort()).toEqual(["B-OWED", "B-PAID"]);
  });

  it("adding items that add up to the bill moves the amount into Inventory and brings the stock in", async () => {
    const edit = await getPurchaseInvoiceForEdit((await billOf("B-OWED")).id);
    expect(edit).toMatchObject({ detailsPending: true, recordedTotal: 2500, lineItems: [] });
    await updatePurchaseInvoice({ billId: edit.billId, invoiceNumber: "B-OWED", invoiceDate: "2026-10-05", vendorId, billType: "no_bill", lines: [{ itemId: widget, description: "", rate: 250, quantity: 10, discount: 0 }], payments: [] });
    expect(await balance("1210")).toBe(1000); // only the other bill is still waiting
    expect(await balance("1200")).toBe(2500);
    expect(await stock()).toBe(10);
    expect(await billOf("B-OWED")).toMatchObject({ detailsPending: false, status: "open", total: "2500.00" });
    expect((await needsAttention(org.tenantId, todayIso())).find((i) => i.id === "details_pending")).toMatchObject({ count: 1, amount: 1000 });
  });

  it("items that do not add up to the bill are refused, unless the person confirms the recorded amount was wrong", async () => {
    const bill = await billOf("B-PAID");
    const lines = [{ itemId: widget, description: "", rate: 100, quantity: 8, discount: 0 }]; // 800, recorded as 1000
    const base = { billId: bill.id, invoiceNumber: "B-PAID", invoiceDate: "2026-10-05", vendorId: "", billType: "no_bill" as const, lines, payments: [{ accountId: cash, amount: 800 }] };
    await expect(updatePurchaseInvoice(base)).rejects.toThrow(/add up to 800.00, but this bill was recorded as 1000.00/);
    expect(await balance("1210")).toBe(1000); // nothing changed
    await updatePurchaseInvoice({ ...base, acceptDifferentTotal: true });
    expect(await balance("1210")).toBe(0);
    expect(await balance("1200")).toBe(2500 + 800);
    expect(await stock()).toBe(18);
    expect((await billOf("B-PAID")).detailsPending).toBe(false);
  });

  it("a bill still waiting can be voided, and nothing is left in the waiting account", async () => {
    await recordPendingPurchases({ rows: [row({ billNumber: "B-VOID", amount: 400, payments: [{ accountId: cash, amount: 400 }] })] });
    expect(await balance("1210")).toBe(400);
    await voidBill(fd((await billOf("B-VOID")).id));
    expect(await balance("1210")).toBe(0);
  });

  it("is refused when the organization keeps no stock", async () => {
    await db.insert(inventorySettings).values({ tenantId: org.tenantId, trackInventory: false }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: { trackInventory: false } });
    await expect(recordPendingPurchases({ rows: [row({ billNumber: "X-1", payments: [{ accountId: cash, amount: 1000 }] })] })).rejects.toThrow(/need inventory tracking/);
  });
});
