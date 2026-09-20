import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "./control-accounts";
import { postJournalEntry } from "./post";
import { syncSupplierOpeningBalanceEntry, syncCustomerOpeningBalanceEntry } from "./opening-balance";
import { signedOpeningBalance } from "./opening-sign";
import { getSupplierBalances, getSupplierLines } from "./supplier-balances";
import { getCustomerBalances } from "./customer-balances";
import { buildStatement } from "./party-statement";
import { listAccountsWithBalances } from "./chart";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const byCode = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Party Ledger Test");
});
afterAll(async () => {
  await org.remove();
});

describe("customer and supplier ledgers follow the ledger", () => {
  it("a supplier opening balance entered as Cr is a credit, and shows as what we owe", async () => {
    const ap = await byCode("2000");
    const acct = await createSubAccount(org.tenantId, ap, "Acme Supplies");
    const [supplier] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Acme Supplies", payableAccountId: acct.id, openingBalance: signedOpeningBalance("supplier", 45000, "CR").toFixed(2) }).returning();
    expect(Number(supplier.openingBalance)).toBe(45000);

    await syncSupplierOpeningBalanceEntry(org.tenantId, supplier.id, supplier.name, 45000, org.userId);
    expect((await getSupplierBalances(org.tenantId))[supplier.id]).toBe(45000);

    // The same amount entered as Dr means the supplier owes US (prepaid).
    await syncSupplierOpeningBalanceEntry(org.tenantId, supplier.id, supplier.name, signedOpeningBalance("supplier", 45000, "DR"), org.userId);
    expect((await getSupplierBalances(org.tenantId))[supplier.id]).toBe(-45000);
    await syncSupplierOpeningBalanceEntry(org.tenantId, supplier.id, supplier.name, 45000, org.userId);
  });

  it("a journal voucher posted to the supplier's account appears on the supplier and in the chart", async () => {
    const [supplier] = await db.select().from(vendors).where(eq(vendors.tenantId, org.tenantId));
    const cash = await byCode("1000");
    await postJournalEntry({
      tenantId: org.tenantId,
      entryDate: "2026-09-20",
      sourceType: "manual",
      referenceNumber: "JV-0001",
      memo: "Cash received from supplier",
      createdBy: org.userId,
      lines: [{ accountId: cash.id, debitAmount: 5000 }, { accountId: supplier.payableAccountId!, creditAmount: 5000 }],
    });

    const lines = (await getSupplierLines(org.tenantId)).get(supplier.id)!;
    const statement = buildStatement(lines, "credit");
    expect(statement.closingBalance).toBe(50000);
    expect(statement.rows.map((r) => r.details)).toContain("Journal voucher JV-0001 — Cash received from supplier");

    // and the Chart of Accounts agrees with the supplier page
    const chart = await listAccountsWithBalances(org.tenantId);
    expect(chart.find((a) => a.id === supplier.payableAccountId)!.own).toBe(50000);
    expect(chart.find((a) => a.code === "2000")!.total).toBe(50000);
    expect((await getSupplierBalances(org.tenantId))[supplier.id]).toBe(50000);
  });

  it("a customer works the same way, debit-normal", async () => {
    const ar = await byCode("1100");
    const acct = await createSubAccount(org.tenantId, ar, "Beta Customer");
    const [customer] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Beta Customer", receivableAccountId: acct.id, openingBalance: "1000.00" }).returning();
    await syncCustomerOpeningBalanceEntry(org.tenantId, customer.id, customer.name, 1000, org.userId);
    const income = await byCode("4000");
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-21", sourceType: "manual", referenceNumber: "JV-0002", createdBy: org.userId, lines: [{ accountId: acct.id, debitAmount: 250 }, { accountId: income.id, creditAmount: 250 }] });
    expect((await getCustomerBalances(org.tenantId))[customer.id]).toBe(1250);
  });
});
