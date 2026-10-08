import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, journalEntries, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { postSalesBatch } from "@/lib/sales/invoice-records";
import { getCustomerLines } from "./customer-balances";
import { buildStatement } from "./party-ledger";
import { createSupplierPayableAccount } from "./subledger-accounts";
import { entryInScope } from "./entry-access";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let customerId: string;
let saleEntry: string;
let manualEntry: string;
let purchaseLikeEntry: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Entry Access");
  [{ id: customerId }] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Acme", openingBalance: "0" }).returning({ id: customers.id });
  const made = await postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [{ invoiceDate: "2026-09-10", customerId, grossAmount: 1000, discountAmount: 0, billType: "zero_rated", payments: [] }]);
  const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, made[0].invoiceId), eq(journalEntries.sourceType, "sale")));
  saleEntry = e.id;
  // an entry between two expense accounts: touches no cash, customer or supplier account
  const rent = await acct("5100");
  const util = await acct("5300");
  manualEntry = (await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-11", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: rent.id, debitAmount: 50 }, { accountId: util.id, creditAmount: 50 }] })).id;
  // an entry on a supplier payable account
  const [{ id: vendorId }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier", openingBalance: "0" }).returning({ id: vendors.id });
  const ap = await createSupplierPayableAccount(org.tenantId, "Supplier");
  await db.update(vendors).set({ payableAccountId: ap.id }).where(eq(vendors.id, vendorId));
  purchaseLikeEntry = (await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-12", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: rent.id, debitAmount: 70 }, { accountId: ap.id, creditAmount: 70 }] })).id;
});
afterAll(async () => {
  await org.remove();
});

describe("which transactions a report may open", () => {
  it("the Ledger scope opens any entry of the organization", async () => {
    for (const id of [saleEntry, manualEntry, purchaseLikeEntry]) expect(await entryInScope(org.tenantId, id, "ledger")).toBe(true);
  });
  it("a customer statement opens only entries that touch a customer receivable account", async () => {
    expect(await entryInScope(org.tenantId, saleEntry, "sales")).toBe(true);
    expect(await entryInScope(org.tenantId, manualEntry, "sales")).toBe(false);
    expect(await entryInScope(org.tenantId, purchaseLikeEntry, "sales")).toBe(false);
  });
  it("a supplier statement opens only entries that touch a supplier payable account", async () => {
    expect(await entryInScope(org.tenantId, purchaseLikeEntry, "purchases")).toBe(true);
    expect(await entryInScope(org.tenantId, saleEntry, "purchases")).toBe(false);
    expect(await entryInScope(org.tenantId, manualEntry, "purchases")).toBe(false);
  });
  it("the Cash and Bank books open only entries that touch a cash or bank account", async () => {
    expect(await entryInScope(org.tenantId, saleEntry, "bank")).toBe(false); // an unpaid invoice moves no cash
    expect(await entryInScope(org.tenantId, manualEntry, "bank")).toBe(false);
    const cash = await acct("1000");
    const withCash = await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-13", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: cash.id, debitAmount: 5 }, { accountId: (await acct("3000")).id, creditAmount: 5 }] });
    expect(await entryInScope(org.tenantId, withCash.id, "bank")).toBe(true);
  });
});

describe("a statement knows which entry each line is and whether it was reversed", () => {
  it("carries the entry, the reversed flag and the entry a reversal undoes", async () => {
    await reverseJournalEntry(org.tenantId, saleEntry, org.userId, "Void");
    const lines = (await getCustomerLines(org.tenantId)).get(customerId)!;
    const statement = buildStatement(lines, "debit", { from: "2026-09-01", to: "2030-12-31" });
    expect(statement.rows).toHaveLength(2);
    const [original, reversal] = statement.rows;
    expect(original).toMatchObject({ entryId: saleEntry, isReversed: true, isReversal: false });
    expect(reversal).toMatchObject({ isReversed: false, isReversal: true, reversalOfId: saleEntry });
    expect(statement.closingBalance).toBe(0);
  });
});
