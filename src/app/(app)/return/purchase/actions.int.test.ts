import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, items, journalEntries, journalLines, purchaseReturns, stockMovements, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { postJournalEntry } from "@/lib/ledger/post";
import { getSupplierBalances } from "@/lib/ledger/supplier-balances";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createPurchaseReturn, voidPurchaseReturn } = await import("./actions");

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0);
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Purchase Return Test");
});
afterAll(async () => {
  await org.remove();
});

describe("purchase returns (credit notes to suppliers)", () => {
  it("reduces what we owe, reverses input VAT and takes stock out; void undoes it all", async () => {
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    const [vendor] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Return Supplier" }).returning();
    const apId = await getOrCreateSupplierPayableAccountId(org.tenantId, vendor.id);
    const inventory = await acct("1200");
    const inputVat = await acct("1300");
    // An earlier purchase of 1,130 (1,000 + 13% VAT) on account.
    await postJournalEntry({
      tenantId: org.tenantId,
      entryDate: "2026-09-01",
      sourceType: "purchase",
      createdBy: org.userId,
      lines: [
        { accountId: inventory.id, debitAmount: 1000 },
        { accountId: inputVat.id, debitAmount: 130 },
        { accountId: apId, creditAmount: 1130 },
      ],
    });
    const [item] = await db.insert(items).values({ tenantId: org.tenantId, name: "Widget", purchasePrice: "100", sellingPrice: "150", stockQuantity: "5", stockValue: "1000" }).returning();
    // stock that is on hand is on the stock card: the 5 units (worth the 1,000 posted to Inventory above) came in on 1 Sep
    await db.insert(stockMovements).values({ tenantId: org.tenantId, itemId: item.id, movementDate: "2026-09-01", type: "opening", quantity: "5", value: "1000", sourceType: "opening", sourceId: item.id });

    await createPurchaseReturn({ noteNumber: "PDN-1", noteDate: "2026-09-10", vendorId: vendor.id, withVat: true, lines: [{ itemId: item.id, description: "Widget", rate: 100, quantity: 2, discount: 0 }] });

    const [note] = await db.select().from(purchaseReturns).where(eq(purchaseReturns.tenantId, org.tenantId));
    expect(Number(note.total)).toBe(226);
    expect((await getSupplierBalances(org.tenantId))[vendor.id]).toBe(1130 - 226);
    expect(await balance("1200")).toBe(1000 - 200);
    expect(await balance("1300")).toBe(130 - 26);
    expect(Number((await db.select().from(items).where(eq(items.id, item.id)))[0].stockQuantity)).toBe(3);

    await expect(createPurchaseReturn({ noteNumber: "PDN-1", noteDate: "2026-09-10", vendorId: vendor.id, withVat: false, lines: [{ itemId: null, description: "x", rate: 10, quantity: 1, discount: 0 }] })).rejects.toThrow(/already used/);
    await expect(createPurchaseReturn({ noteNumber: "PDN-2", noteDate: "2026-09-10", vendorId: vendor.id, withVat: false, lines: [{ itemId: item.id, description: "Widget", rate: 100, quantity: 4, discount: 0 }] })).rejects.toThrow(/in stock/);

    await voidPurchaseReturn(Object.assign(new FormData(), { get: () => note.id }) as unknown as FormData);
    expect((await getSupplierBalances(org.tenantId))[vendor.id]).toBe(1130);
    expect(await balance("1200")).toBe(1000);
    expect(Number((await db.select().from(items).where(eq(items.id, item.id)))[0].stockQuantity)).toBe(5);
  });
});
