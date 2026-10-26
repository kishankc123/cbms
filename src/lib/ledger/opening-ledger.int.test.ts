import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, customers, tenants, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { loadOpeningSheet, saveOpeningSheet } from "./opening-ledger";
import { listAccountsWithBalances, createSubGroupEntry } from "./chart";
import { syncCustomerOpeningBalanceEntry } from "./opening-balance";
import { createCustomerReceivableAccount, createSupplierPayableAccount } from "./subledger-accounts";
import { postJournalEntry } from "./post";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const DATE = "2025-07-17";
const byCode = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const balance = async (id: string) => (await listAccountsWithBalances(org.tenantId)).find((a) => a.id === id)!.own;
const row = async (id: string) => (await loadOpeningSheet(org.tenantId)).rows.find((r) => r.id === id);
const save = (netDebits: Record<string, number>, date = DATE) => saveOpeningSheet(org.tenantId, org.userId, { date, netDebits });

beforeAll(async () => {
  org = await createTempOrg("ZZ Opening Sheet");
  await db.update(tenants).set({ fiscalYearStartDate: DATE }).where(eq(tenants.id, org.tenantId));
});
afterAll(async () => {
  await org.remove();
});

describe("opening balances of ledger accounts", () => {
  it("lists every balance sheet leaf account, and sends only stock and assets to their own screens", async () => {
    const sheet = await loadOpeningSheet(org.tenantId);
    const find = async (code: string) => { const id = (await byCode(code)).id; return sheet.rows.find((r) => r.id === id); };
    expect(await find("1300")).toMatchObject({ screen: null, net: 0 });
    expect(await find("1000")).toMatchObject({ screen: null }); // cash is typed here too
    expect(await find("1200")).toMatchObject({ screen: "/inventory/stock" });
    expect(await find("1500")).toMatchObject({ screen: "/assets" });
    expect(await find("4000")).toBeUndefined(); // income is not a balance sheet account
    expect(await find("3200")).toBeUndefined(); // Brought forward itself
    expect(sheet.rows.slice(-3).map((r) => r.screen)).toEqual(["/inventory/stock", "/assets", "/assets"]); // at the bottom
    expect(sheet.date).toBe(DATE);
  });

  it("saves one balanced entry against Brought forward, and saving again replaces it", async () => {
    const prepaid = await byCode("1300");
    const capital = await byCode("3000");
    await save({ [prepaid.id]: 5000, [capital.id]: -2000 });
    expect(await balance(prepaid.id)).toBe(5000);
    expect(await balance(capital.id)).toBe(2000);
    expect(await balance((await byCode("3200")).id)).toBe(3000);
    expect(await row(prepaid.id)).toMatchObject({ net: 5000, other: 0 });

    await save({ [prepaid.id]: 1000, [capital.id]: 0 });
    expect(await balance(prepaid.id)).toBe(1000);
    expect(await balance(capital.id)).toBeCloseTo(0);

    await save({ [prepaid.id]: 0 });
    expect(await balance(prepaid.id)).toBeCloseTo(0);
  });

  it("an unchanged sheet keeps what was entered earlier", async () => {
    const prepaid = await byCode("1300");
    await save({ [prepaid.id]: 700 });
    await save({});
    expect(await balance(prepaid.id)).toBe(700);
  });

  it("writes a customer, a supplier and a bank row through to their own records", async () => {
    const customerAcct = await createCustomerReceivableAccount(org.tenantId, "ZZ Customer");
    const [customer] = await db.insert(customers).values({ tenantId: org.tenantId, name: "ZZ Customer", receivableAccountId: customerAcct.id }).returning();
    await syncCustomerOpeningBalanceEntry(org.tenantId, customer.id, customer.name, 400, org.userId);
    const supplierAcct = await createSupplierPayableAccount(org.tenantId, "ZZ Supplier");
    const [supplier] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "ZZ Supplier", payableAccountId: supplierAcct.id }).returning();
    const bankAcct = await createSubGroupEntry(org.tenantId, org.userId, { parentAccountId: (await byCode("1010")).id, name: "ZZ Bank" });

    expect(await row(customerAcct.id)).toMatchObject({ net: 400, screen: null }); // entered on its own screen, shown here
    await save({ [customerAcct.id]: 900, [supplierAcct.id]: -2500, [bankAcct.id]: 1200 });

    expect(Number((await db.select().from(customers).where(eq(customers.id, customer.id)))[0].openingBalance)).toBe(900); // owed to us
    expect(Number((await db.select().from(vendors).where(eq(vendors.id, supplier.id)))[0].openingBalance)).toBe(2500); // we owe
    expect(Number((await db.select().from(bankAccounts).where(eq(bankAccounts.chartOfAccountsLink, bankAcct.id)))[0].openingBalance)).toBe(1200);
    expect(await balance(customerAcct.id)).toBe(900);
    expect(await balance(supplierAcct.id)).toBe(2500);
    expect(await balance(bankAcct.id)).toBe(1200);
    expect(await row(supplierAcct.id)).toMatchObject({ net: -2500 });
  });

  it("keeps the opening balance date, and refuses to move it past openings other screens dated", async () => {
    const prepaid = await byCode("1300");
    await save({ [prepaid.id]: 100 }, DATE);
    await expect(save({ [prepaid.id]: 100 }, "2025-08-01")).rejects.toThrow(/already have opening balances dated/);
  });

  it("refuses an account that is not on the sheet or has its own screen", async () => {
    await expect(save({ [(await byCode("4000")).id]: 10 })).rejects.toThrow(/can't be changed here/);
    await expect(save({ [(await byCode("1200")).id]: 10 })).rejects.toThrow(/can't be changed here/);
  });

  it("types the total wanted on an account that another source already put an opening on", async () => {
    const tax = await byCode("2100");
    await postJournalEntry({
      tenantId: org.tenantId,
      entryDate: DATE,
      sourceType: "opening_balance",
      sourceId: crypto.randomUUID(),
      memo: "Other screen",
      createdBy: org.userId,
      lines: [
        { accountId: tax.id, creditAmount: 300 },
        { accountId: (await byCode("3200")).id, debitAmount: 300 },
      ],
    });
    expect(await row(tax.id)).toMatchObject({ net: -300, other: -300 });
    await save({ [tax.id]: -500 });
    expect(await balance(tax.id)).toBe(500);
    expect(await row(tax.id)).toMatchObject({ net: -500, other: -300 });
  });
});
