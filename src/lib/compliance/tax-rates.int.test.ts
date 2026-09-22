import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, items, journalEntries, journalLines, purchaseBills, salesInvoices, taxRates, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { changeTaxRate, getCurrentTaxRateInfo, getTaxRate, getTaxRateHistory } from "./tax-rates";
import { salesVatRate } from "@/lib/sales/vat";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createSingleInvoice } = await import("../../app/(app)/sales/actions");
const { createPurchaseInvoice } = await import("../../app/(app)/purchases/actions");

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function taxLine(sourceType: "sale" | "purchase", sourceId: string, taxAccountId: string) {
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId), eq(journalLines.accountId, taxAccountId)));
  return rows.reduce((s, r) => s + Number(r.d) + Number(r.c), 0);
}

let customerId: string;
let vendorId: string;
let itemId: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Tax Rate Test");
  await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
  customerId = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Customer" }).returning())[0].id;
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Vendor" }).returning())[0].id;
  itemId = (await db.insert(items).values({ tenantId: org.tenantId, name: "Widget" }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("versioned tax rates", () => {
  it("seeds one open-ended rate per tax type, and a lookup on any date finds it", async () => {
    expect(await getTaxRate(org.tenantId, "vat", "2020-01-01")).toBe(13);
    expect(await getTaxRate(org.tenantId, "vat", "2026-09-01")).toBe(13);
    const history = await getTaxRateHistory(org.tenantId, "vat");
    expect(history.length).toBe(1);
    expect(history[0].effectiveTo).toBeNull();
  });

  it("refuses a no-op change, a change effective on or before the current rate's start, and an out-of-range rate", async () => {
    await expect(changeTaxRate(org.tenantId, org.userId, { taxTypeKey: "vat", rate: 13, effectiveFrom: "2026-10-01" })).rejects.toThrow(/already the current rate/);
    await expect(changeTaxRate(org.tenantId, org.userId, { taxTypeKey: "vat", rate: 15, effectiveFrom: "1999-01-01" })).rejects.toThrow(/must take effect after/);
    await expect(changeTaxRate(org.tenantId, org.userId, { taxTypeKey: "vat", rate: 150, effectiveFrom: "2026-10-01" })).rejects.toThrow(/between 0 and 100/);
  });

  it("changing the rate closes the old row and starts a new one — old dates keep the old rate, new dates get the new one", async () => {
    await changeTaxRate(org.tenantId, org.userId, { taxTypeKey: "vat", rate: 15, effectiveFrom: "2026-10-01", reason: "Government rate change" });

    expect(await getTaxRate(org.tenantId, "vat", "2026-09-30")).toBe(13);
    expect(await getTaxRate(org.tenantId, "vat", "2026-10-01")).toBe(15);
    expect(await getTaxRate(org.tenantId, "vat", "2026-12-01")).toBe(15);

    const history = await getTaxRateHistory(org.tenantId, "vat");
    expect(history.length).toBe(2);
    expect(history[0].rate).toBe(15);
    expect(history[0].effectiveTo).toBeNull();
    expect(history[1].rate).toBe(13);
    expect(history[1].effectiveTo).toBe("2026-09-30");
  });

  it("salesVatRate uses the rate as of the given date, defaulting to today", async () => {
    expect(await salesVatRate(org.tenantId, "2026-09-15")).toBe(13);
    expect(await salesVatRate(org.tenantId, "2026-10-15")).toBe(15);
  });

  it("a rate published by a platform administrator can't be self-serve changed by the organization", async () => {
    // Not built yet, but the column already exists — this proves the guard works the moment something sets it.
    await db.update(taxRates).set({ source: "platform" }).where(and(eq(taxRates.tenantId, org.tenantId), eq(taxRates.taxTypeKey, "tds")));
    const info = await getCurrentTaxRateInfo(org.tenantId, "tds");
    expect(info.source).toBe("platform");
    await expect(changeTaxRate(org.tenantId, org.userId, { taxTypeKey: "tds", rate: 5, effectiveFrom: "2026-11-01" })).rejects.toThrow(/published by your administrator/);
  });
});

describe("posted documents are taxed at the rate in force on their own date", () => {
  it("a sale dated before the rate change is taxed at 13%, even when entered after the rate is now 15%", async () => {
    const taxPayable = await acct("2100");
    await createSingleInvoice({ invoiceNumber: "S-OLD", invoiceDate: "2026-09-20", customerId, lines: [{ itemId: null, description: "x", rate: 1000, quantity: 1, discount: 0 }], payments: [] });
    const [invoice] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, org.tenantId), eq(salesInvoices.invoiceNumber, "S-OLD")));
    expect(Number(invoice.taxAmount)).toBe(130); // 13% of 1,000, not 15%
    expect(await taxLine("sale", invoice.id, taxPayable.id)).toBe(130);
  });

  it("a sale dated after the rate change is taxed at 15%", async () => {
    await createSingleInvoice({ invoiceNumber: "S-NEW", invoiceDate: "2026-10-05", customerId, lines: [{ itemId: null, description: "x", rate: 1000, quantity: 1, discount: 0 }], payments: [] });
    const [invoice] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, org.tenantId), eq(salesInvoices.invoiceNumber, "S-NEW")));
    expect(Number(invoice.taxAmount)).toBe(150); // 15% of 1,000
  });

  it("a stockable purchase bill dated before the rate change is taxed at 13% too", async () => {
    await createPurchaseInvoice({ invoiceNumber: "PB-OLD", invoiceDate: "2026-09-22", vendorId, billType: "vat", lines: [{ itemId, description: "x", rate: 1000, quantity: 1, discount: 0 }], payments: [] });
    const [bill] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, "PB-OLD")));
    expect(Number(bill.taxAmount)).toBe(130);
  });
});
