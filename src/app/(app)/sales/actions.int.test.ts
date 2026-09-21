import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, accounts, customers, journalEntries, salesInvoices, tenantTaxRegistrations } from "@/db/schema";
import { createPayment } from "@/lib/ledger/payments-engine";
import { getCustomerAdvanceBalance } from "@/lib/ledger/advance-accounts";
import { createTempOrg } from "@/test/temp-org";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createSingleInvoice, recordSalesBatch } = await import("./actions");

const line = (rate: number, quantity = 1) => ({ itemId: null, description: "Service", rate, quantity, discount: 0 });
const invoices = () => db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, org.tenantId));
let customerId: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Sales Rules Test");
  [{ id: customerId }] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Rules Customer" }).returning({ id: customers.id });
});
afterAll(async () => {
  await org.remove();
});

describe("sales invoice rules", () => {
  it("charges no VAT until the organization holds an active VAT registration", async () => {
    await createSingleInvoice({ invoiceNumber: "R-1", invoiceDate: "2026-09-01", customerId, lines: [line(1000)], payments: [] });
    expect(Number((await invoices()).find((i) => i.invoiceNumber === "R-1")!.taxAmount)).toBe(0);

    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    await createSingleInvoice({ invoiceNumber: "R-2", invoiceDate: "2026-09-01", customerId, lines: [line(1000)], payments: [] });
    const r2 = (await invoices()).find((i) => i.invoiceNumber === "R-2")!;
    expect(Number(r2.taxAmount)).toBe(130);
    expect(Number(r2.total)).toBe(1130);
  });

  it("does not allow the same invoice number twice", async () => {
    await expect(createSingleInvoice({ invoiceNumber: "R-2", invoiceDate: "2026-09-02", customerId, lines: [line(10)], payments: [] })).rejects.toThrow(/already used/);
  });

  it("generated batch numbers skip numbers already taken", async () => {
    await recordSalesBatch({ rows: [{ invoiceDate: "2026-09-03", customerId, grossAmount: 100, discountAmount: 0, payments: [] }] });
    await recordSalesBatch({ rows: [{ invoiceDate: "2026-09-03", customerId, grossAmount: 100, discountAmount: 0, payments: [] }] });
    const numbers = (await invoices()).map((i) => i.invoiceNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("a locked period refuses the invoice and leaves nothing behind", async () => {
    await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: "2026-01-01", periodEnd: "2026-01-31", label: "Jan (test)", status: "closed" });
    const before = (await invoices()).length;
    const entriesBefore = (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
    await expect(createSingleInvoice({ invoiceNumber: "R-LOCKED", invoiceDate: "2026-01-15", customerId, lines: [line(100)], payments: [] })).rejects.toThrow(/closed period/);
    expect((await invoices()).length).toBe(before);
    expect((await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId)))).length).toBe(entriesBefore);
  });

  it("an advance the customer has paid is applied to the new invoice automatically", async () => {
    // a customer with no other open invoices, so the new one is the oldest
    const [{ id: advCustomer }] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Advance Customer" }).returning({ id: customers.id });
    const [cash] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000")));
    await createPayment(org.tenantId, org.userId, "TMP-ADV", { direction: "money_in", paymentType: "customer_advance", paymentDate: "2026-09-01", partyType: "customer", customerId: advCustomer, accountId: cash.id, paymentMethod: "cash", amount: 500, confirmDuplicate: true });
    await createSingleInvoice({ invoiceNumber: "ADV-1", invoiceDate: "2026-09-10", customerId: advCustomer, lines: [line(200)], payments: [] });
    const inv = (await invoices()).find((i) => i.invoiceNumber === "ADV-1")!;
    expect(inv.status).toBe("paid");
    expect(Number(inv.amountPaid)).toBe(Number(inv.total));
    expect(await getCustomerAdvanceBalance(org.tenantId, advCustomer)).toBe(500 - Number(inv.total));
  });
});
