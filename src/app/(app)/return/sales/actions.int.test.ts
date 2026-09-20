import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, items, journalEntries, journalLines, salesReturns, tenantTaxRegistrations } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getOrCreateCustomerReceivableAccountId } from "@/lib/ledger/subledger-accounts";
import { postJournalEntry } from "@/lib/ledger/post";
import { getCustomerBalances } from "@/lib/ledger/customer-balances";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createSalesReturn, voidSalesReturn } = await import("./actions");

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
  org = await createTempOrg("ZZ Sales Return Test");
});
afterAll(async () => {
  await org.remove();
});

describe("sales returns (debit notes)", () => {
  it("reduces what the customer owes, reverses VAT and puts stock back; void undoes it all", async () => {
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    const [customer] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Return Customer" }).returning();
    const arId = await getOrCreateCustomerReceivableAccountId(org.tenantId, customer.id);
    const cash = await acct("1000");
    const revenue = await acct("4000");
    // A prior sale of 1,130 (1,000 + 13% VAT) so there is something to return against.
    const tax = await acct("2100");
    await postJournalEntry({
      tenantId: org.tenantId,
      entryDate: "2026-09-01",
      sourceType: "sale",
      createdBy: org.userId,
      lines: [
        { accountId: arId, debitAmount: 1130 },
        { accountId: revenue.id, creditAmount: 1000 },
        { accountId: tax.id, creditAmount: 130 },
      ],
    });
    expect(cash).toBeTruthy();
    const [item] = await db.insert(items).values({ tenantId: org.tenantId, name: "Widget", purchasePrice: "60", sellingPrice: "100", stockQuantity: "5" }).returning();

    await createSalesReturn({ noteNumber: "DN-1", noteDate: "2026-09-10", customerId: customer.id, lines: [{ itemId: item.id, description: "Widget", rate: 100, quantity: 2, discount: 0 }] });

    const [note] = await db.select().from(salesReturns).where(eq(salesReturns.tenantId, org.tenantId));
    // VAT-registered, rate 13: taxable 200, VAT 26, total 226.
    expect(Number(note.total)).toBe(226);
    expect((await getCustomerBalances(org.tenantId))[customer.id]).toBe(1130 - 226);
    expect(await balance("4000")).toBe(-1000);
    expect(await balance("4050")).toBe(200); // the return sits in its own Chart of Accounts line
    expect(await balance("2100")).toBe(-130 + 26);
    expect(await balance("1200")).toBe(120); // 2 x purchase price 60 back in stock
    expect(await balance("5000")).toBe(-120);
    expect(Number((await db.select().from(items).where(eq(items.id, item.id)))[0].stockQuantity)).toBe(7);

    // The same number cannot be used twice.
    await expect(createSalesReturn({ noteNumber: "DN-1", noteDate: "2026-09-10", customerId: customer.id, lines: [{ itemId: null, description: "x", rate: 10, quantity: 1, discount: 0 }] })).rejects.toThrow(/already used/);

    await voidSalesReturn(Object.assign(new FormData(), { get: () => note.id }) as unknown as FormData);
    expect((await getCustomerBalances(org.tenantId))[customer.id]).toBe(1130);
    expect(await balance("1200")).toBe(0);
    expect(Number((await db.select().from(items).where(eq(items.id, item.id)))[0].stockQuantity)).toBe(5);
    expect((await db.select().from(salesReturns).where(eq(salesReturns.id, note.id)))[0].status).toBe("void");
  });
});
