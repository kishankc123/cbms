import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { assertCashBankAccounts, assertSettlementAccounts } from "@/lib/ledger/account-guards";
import { listSettlementAccounts } from "@/lib/ledger/settlement-accounts";
import { buildPaymentResolver, resolvePaymentMode } from "@/lib/payment-modes";
import { finishExpenseImport, importExpenseChunk, prepareExpenseImport, reviewExpenseFile } from "@/lib/expenses/import/service";
import type { ExpenseImportSettings, ExpenseRunInput } from "@/lib/expenses/import/types";

// A bill paid by a director: the money goes through his account in the Chart of Accounts, not through cash or bank.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let groupId: string;
let sudipId: string;
let cashId: string;
let salesId: string;
let rentName: string;
let rentId: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Settlement");
  [{ id: groupId }] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "2400", name: "Director", category: "liability", subCategory: "Current liabilities" }).returning({ id: accounts.id });
  [{ id: sudipId }] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "2400.01", name: "Sudip KC", category: "liability", subCategory: "Current liabilities", parentAccountId: groupId }).returning({ id: accounts.id });
  await db.insert(accounts).values({ tenantId: org.tenantId, code: "2400.02", name: "Ram Rana", category: "liability", subCategory: "Current liabilities", parentAccountId: groupId });
  const find = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
  cashId = (await find("1000")).id;
  salesId = (await find("4000")).id;
  const rent = await find("5100");
  [rentName, rentId] = [rent.name, rent.id];
});
afterAll(async () => {
  await org.remove();
});

describe("settling through a ledger account", () => {
  it("offers the lowest-level asset, liability and equity accounts, and not groups, income, expenses or the accounts the app keeps itself", async () => {
    const list = await listSettlementAccounts(org.tenantId);
    const ids = new Set(list.map((a) => a.id));
    expect(ids.has(sudipId)).toBe(true);
    expect(ids.has(groupId)).toBe(false); // a group with sub-groups
    expect(ids.has(salesId)).toBe(false); // income
    expect(ids.has(rentId)).toBe(false); // an expense
    expect(list.some((a) => a.code === "2100" || a.code === "1300")).toBe(false); // VAT
    expect(list.some((a) => a.code === "1010.01" || a.code === "3100")).toBe(false); // cash and bank are chosen through the payment modes
    expect(list.some((a) => a.code === "3000")).toBe(true); // the owner's capital may pay a bill
  });

  it("an import cell can name the account as Group: Name, with a > or a colon, by its name alone, or by its code", async () => {
    const r = await buildPaymentResolver(org.tenantId);
    for (const text of ["Director: Sudip KC", "director > sudip kc", "Director:Sudip KC", "Sudip KC", "2400.01"]) expect(r.resolve(text)).toEqual({ accountId: sudipId, modeId: null });
    expect(r.resolve("Director")).toBeNull(); // the group itself
    expect(r.resolve("Sales Revenue")).toBeNull();
    expect(r.resolve("Cash")).toMatchObject({ accountId: cashId }); // cash still works as before
  });

  it("the paid-from check accepts it, while a transfer between own accounts still needs cash or bank", async () => {
    await expect(assertSettlementAccounts(org.tenantId, [sudipId, cashId])).resolves.toBeUndefined();
    await expect(assertSettlementAccounts(org.tenantId, [salesId])).rejects.toThrow(/ledger account you can settle through/);
    await expect(assertCashBankAccounts(org.tenantId, [sudipId])).rejects.toThrow(/Cash or Bank/);
  });

  it("is recorded as a payment that did not go through cash", async () => {
    expect(await resolvePaymentMode(org.tenantId, null, sudipId)).toMatchObject({ paymentModeId: null, paymentMethod: "other" });
    expect(await resolvePaymentMode(org.tenantId, null, cashId)).toMatchObject({ paymentMethod: "cash" });
  });

  it("an imported expense written as Director: Sudip KC debits the expense and credits his account, with no cash moved", { timeout: 300000 }, async () => {
    const settings: ExpenseImportSettings = { defaultBillType: "pan", paidMode: "file", defaultAccountId: null, defaultCategoryId: null };
    const csv = ["Date,Supplier,Category,Invoice number,Description,Amount,Paid amount,Paid from", `2026-09-12,,${rentName},,Repair,18000,18000,Director: Sudip KC`, `2026-09-13,,${rentName},,Repair,500,500,Nobody: Else`].join("\n");
    const input: ExpenseRunInput = { fileName: "e.csv", base64: Buffer.from(csv, "utf8").toString("base64"), settings, supplierDecisions: {}, categoryDecisions: {}, skipRows: [], includeDuplicates: false };

    const review = await reviewExpenseFile(org.tenantId, { fileName: "e.csv", base64: input.base64, settings });
    expect(review.rows.find((r) => r.rowNumber === 2)).toMatchObject({ status: "ready", total: 18000, paid: 18000 });
    expect(review.rows.find((r) => r.rowNumber === 3)?.status).toBe("attention"); // an unknown account is still reported

    const ctx = { tenantId: org.tenantId, userId: org.userId };
    const prep = await prepareExpenseImport(ctx, input);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(await importExpenseChunk(ctx, { ...input, supplierDecisions: prep.supplierDecisions, importId: prep.importId, rowNumbers: [2] })).toMatchObject({ ok: true });
    await finishExpenseImport(ctx, { importId: prep.importId, stopped: false });

    const lines = await db
      .select({ account: journalLines.accountId, debit: journalLines.debitAmount, credit: journalLines.creditAmount })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(eq(journalEntries.tenantId, org.tenantId));
    const total = (id: string, side: "debit" | "credit") => lines.filter((l) => l.account === id).reduce((s, l) => s + Number(l[side]), 0);
    expect(total(sudipId, "credit")).toBe(18000); // the company now owes him
    expect(total(cashId, "credit")).toBe(0);
    expect(total(rentId, "debit")).toBe(18000);
    const [expense] = await db.select().from(expenses).where(eq(expenses.tenantId, org.tenantId));
    expect(Number(expense.amountPaid)).toBe(18000); // settled in full
  });
});
