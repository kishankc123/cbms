import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, salesInvoices } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { postSalesBatch } from "@/lib/sales/invoice-records";
import { assertRevenueAccount, getRevenueAccounts } from "@/lib/sales/revenue-accounts";
import { runSalesImport } from "@/lib/sales/import/service";
import type { ImportSettings } from "@/lib/sales/import/types";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let serviceId: string;
let otherIncomeId: string;
let defaultId: string;
let cashId: string;

const creditsTo = async (accountId: string, invoiceId: string) => {
  const rows = await db
    .select({ c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, invoiceId), eq(journalEntries.sourceType, "sale"), eq(journalLines.accountId, accountId)));
  return rows.reduce((s, r) => s + Number(r.c), 0);
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Revenue Accounts");
  const [sales] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "4000")));
  defaultId = sales.id;
  cashId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
  otherIncomeId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "4100"))))[0].id;
  serviceId = (await createSubAccount(org.tenantId, sales, "Service Income")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("revenue accounts", () => {
  it("offers only the lowest level, and never sales returns or a group with sub-groups", async () => {
    const list = await getRevenueAccounts(org.tenantId);
    const codes = list.map((a) => a.code);
    expect(list.some((a) => a.id === serviceId)).toBe(true);
    expect(codes).toContain("4100");
    expect(codes).not.toContain("4000"); // now a group
    expect(codes).not.toContain("4050");
    await expect(assertRevenueAccount(org.tenantId, defaultId)).rejects.toThrow(/sub-groups/);
    await expect(assertRevenueAccount(org.tenantId, serviceId)).resolves.toBe(serviceId);
  });

  it("an invoice posts to the account chosen for it, and remembers it", async () => {
    const [made] = await postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [{ invoiceDate: "2026-09-10", customerId: "", grossAmount: 1000, discountAmount: 0, billType: "zero_rated", revenueAccountId: serviceId, payments: [{ accountId: cashId, amount: 1000 }] }]);
    const [inv] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, made.invoiceId));
    expect(inv.revenueAccountId).toBe(serviceId);
    expect(await creditsTo(serviceId, made.invoiceId)).toBe(1000);
    await expect(postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [{ invoiceDate: "2026-09-10", customerId: "", grossAmount: 10, discountAmount: 0, revenueAccountId: "00000000-0000-0000-0000-000000000000", payments: [{ accountId: cashId, amount: 10 }] }])).rejects.toThrow(/revenue account/);
  });

  it("an import takes the revenue account from the file, else from the default setting", { timeout: 200000 }, async () => {
    const csv = ["Date,Amount,Bill Type,Revenue", "2026-09-11,500,Zero rated,Service Income", "2026-09-12,300,Zero rated,"].join("\n");
    const settings: ImportSettings = { amountsIncludeVat: false, defaultBillType: "zero_rated", paidMode: "full", defaultAccountId: cashId, defaultRevenueAccountId: otherIncomeId };
    const r = await runSalesImport(
      { tenantId: org.tenantId, userId: org.userId },
      {
        fileName: "s.csv",
        base64: Buffer.from(csv, "utf8").toString("base64"),
        mapping: { date: "Date", amount: "Amount", billType: "Bill Type", revenue: "Revenue" },
        dateOptions: { choice: "AD", dayFirst: true, allowMixed: false },
        settings,
        decisions: {},
        skipRows: [],
        includeDuplicates: true,
      }
    );
    expect(r).toMatchObject({ ok: true, imported: 2 });
    if (!r.ok) return;
    const made = await db.select().from(salesInvoices).where(eq(salesInvoices.importId, r.importId));
    expect(made.find((i) => Number(i.total) === 500)?.revenueAccountId).toBe(serviceId);
    expect(made.find((i) => Number(i.total) === 300)?.revenueAccountId).toBe(otherIncomeId);
  });
});
