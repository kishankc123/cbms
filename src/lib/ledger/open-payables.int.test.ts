import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getOrCreateRecurringPayableGroup } from "@/lib/recurring-expenses/payable-account";
import { createSubAccount, getOrCreateBroughtForwardAccount } from "./control-accounts";
import { postJournalEntry } from "./post";
import { createPayment, voidPayment } from "./payments-engine";
import { openPayables } from "./open-payables";

// Rent owed before the books started sits on its payable as an opening balance, with no expense bill. A ledger payment can clear that part, and only that part:
// what has a bill is paid by settling the bill.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let rentId: string;
let miscId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const owedOnRent = async () => Math.round((await db.select().from(journalLines).where(eq(journalLines.accountId, rentId))).reduce((s, l) => s + Number(l.creditAmount) - Number(l.debitAmount), 0) * 100) / 100;
const pay = (amount: number, categoryAccountId: string = rentId) =>
  createPayment(org.tenantId, org.userId, "TMP", { direction: "money_out", paymentType: "ledger_payment", paymentDate: "2026-09-10", partyType: "none", accountId: cashId, paymentMethod: "cash", amount, categoryAccountId, confirmDuplicate: true });

beforeAll(async () => {
  org = await createTempOrg("ZZ Opening Payable");
  cashId = (await acct("1000")).id;
  miscId = (await acct("5900")).id;
  rentId = (await createSubAccount(org.tenantId, await getOrCreateRecurringPayableGroup(org.tenantId), "Rent payable")).id;
  const bf = await getOrCreateBroughtForwardAccount(org.tenantId);
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: bf.id, debitAmount: 35000 }, { accountId: rentId, creditAmount: 35000 }] });
});
afterAll(async () => {
  await org.remove();
});

describe("paying an opening balance on a recurring payable", () => {
  let paymentId: string;

  it("is offered for what no bill covers, and not beyond it", async () => {
    expect((await openPayables(org.tenantId)).map((a) => [a.name, a.unbilled])).toEqual([["Rent payable", 35000]]);
    await expect(pay(36000)).rejects.toThrow(/Only 35000.00/);
  });

  it("clears the opening balance from the money-out ledger payment", async () => {
    paymentId = ((await pay(35000)) as { paymentId: string }).paymentId;
    expect(await owedOnRent()).toBe(0);
    expect(await openPayables(org.tenantId)).toEqual([]);
    // an edit of that payment still sees what it paid as available to it
    expect((await openPayables(org.tenantId, { excludePaymentId: paymentId }))[0].unbilled).toBe(35000);
  });

  it("leaves a billed amount to be paid against the bill", async () => {
    await voidPayment(org.tenantId, paymentId, org.userId, "Test");
    // a 1,000 bill owed on the same account (as a recurring expense makes it): the books owe 36,000, of which 1,000 has a bill
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-05", sourceType: "expense", createdBy: org.userId, lines: [{ accountId: miscId, debitAmount: 1000 }, { accountId: rentId, creditAmount: 1000 }] });
    await db.insert(expenses).values({ tenantId: org.tenantId, expenseNumber: "EXP-T1", expenseDate: "2026-09-05", categoryAccountId: miscId, description: "Rent", billType: "no_bill", taxableAmount: "1000", subtotal: "1000", total: "1000", amountPayable: "1000", amountPaid: "0", status: "unpaid", payableAccountId: rentId, createdBy: org.userId } as never);
    expect(await owedOnRent()).toBe(36000);
    expect((await openPayables(org.tenantId))[0].unbilled).toBe(35000);
  });

  it("is not offered for any other account the app keeps", async () => {
    await expect(pay(100, (await acct("1200")).id)).rejects.toThrow();
  });
});
