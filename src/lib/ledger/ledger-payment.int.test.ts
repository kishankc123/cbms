import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment } from "./payments-engine";

// Money in from, or out to, any ledger account of the Chart of Accounts: a director putting money in and being repaid.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let directorId: string;
let salesId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const pay = (over: Record<string, unknown>) =>
  createPayment(org.tenantId, org.userId, "TMP", {
    direction: "money_in",
    paymentType: "ledger_receipt",
    paymentDate: "2026-09-05",
    partyType: "none",
    accountId: cashId,
    paymentMethod: "cash",
    amount: 5000,
    confirmDuplicate: true,
    ...over,
  } as never);
const total = async (accountId: string, side: "debit" | "credit") => {
  const lines = await db.select({ a: journalLines.accountId, d: journalLines.debitAmount, c: journalLines.creditAmount }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId)).where(eq(journalEntries.tenantId, org.tenantId));
  return lines.filter((l) => l.a === accountId).reduce((s, l) => s + Number(side === "debit" ? l.d : l.c), 0);
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Ledger Payment");
  const [group] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "2400", name: "Director", category: "liability", subCategory: "Current liabilities" }).returning({ id: accounts.id });
  [{ id: directorId }] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "2400.01", name: "Sudip KC", category: "liability", subCategory: "Current liabilities", parentAccountId: group.id }).returning({ id: accounts.id });
  cashId = (await acct("1000")).id;
  salesId = (await acct("4000")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("money from or to a ledger account", () => {
  it("money in debits cash and credits the director's account", async () => {
    await pay({ categoryAccountId: directorId });
    expect(await total(cashId, "debit")).toBe(5000);
    expect(await total(directorId, "credit")).toBe(5000);
  });

  it("money out to the ledger account debits it and credits cash", async () => {
    await pay({ direction: "money_out", paymentType: "ledger_payment", amount: 2000, categoryAccountId: directorId });
    expect(await total(directorId, "debit")).toBe(2000);
    expect(await total(cashId, "credit")).toBe(2000);
  });

  it("needs a ledger account that can be settled through, not income or nothing", async () => {
    await expect(pay({})).rejects.toThrow(/Choose the ledger account/);
    await expect(pay({ categoryAccountId: salesId })).rejects.toThrow(/ledger account you can settle through/);
  });
});
