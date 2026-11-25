import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, journalEntries, journalLines, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createExpenseCore, type ExpenseInput } from "@/lib/expenses/expense-records";
import { createPayment, voidPayment } from "./payments-engine";

// One payment can settle several expenses: whole of one and part of another. Each takes what is allocated to it and the rest stays outstanding.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let miscId: string;
let first: string;
let second: string;
let supplier: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const expense = (amount: number): ExpenseInput => ({ expenseDate: "2026-09-01", categoryAccountId: miscId, vendorId: supplier, description: "Hall rent", invoiceNumber: "", invoiceDate: "", dueDate: "", billType: "no_bill", taxTreatment: "taxable", taxableAmount: amount, vatAmount: 0, tdsAmount: 0, otherTaxAmount: 0, payments: [] });
const row = async (id: string) => (await db.select().from(expenses).where(eq(expenses.id, id)))[0];
const pay = (amount: number, allocations: { targetId: string; allocatedAmount: number }[]) =>
  createPayment(org.tenantId, org.userId, "TMP", {
    direction: "money_out",
    paymentType: "expense_payment",
    paymentDate: "2026-09-10",
    partyType: "supplier",
    vendorId: supplier,
    accountId: cashId,
    paymentMethod: "cash",
    amount,
    confirmDuplicate: true,
    allocations: allocations.map((a) => ({ targetType: "expense" as const, ...a })),
  });

beforeAll(async () => {
  org = await createTempOrg("ZZ Multi Expense Payment");
  cashId = (await acct("1000")).id;
  miscId = (await acct("5900")).id;
  supplier = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Hall owner" }).returning())[0].id;
  first = (await createExpenseCore({ tenantId: org.tenantId, userId: org.userId }, expense(15000))).expenseId;
  second = (await createExpenseCore({ tenantId: org.tenantId, userId: org.userId }, expense(24000))).expenseId;
});
afterAll(async () => {
  await org.remove();
});

describe("a payment that settles two expenses", () => {
  let paymentId: string;

  it("pays the first in full and part of the second, leaving the rest of the second outstanding", async () => {
    // 25,000 = all of the first (15,000) and 10,000 of the second (24,000)
    const made = await pay(25000, [{ targetId: first, allocatedAmount: 15000 }, { targetId: second, allocatedAmount: 10000 }]);
    paymentId = (made as { paymentId: string }).paymentId;
    expect(await row(first)).toMatchObject({ status: "paid", amountPaid: "15000.00" });
    expect(await row(second)).toMatchObject({ status: "partially_paid", amountPaid: "10000.00" });
    const entry = (await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, "payment"))))[0];
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
    expect(lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0)).toBe(0);
    expect(lines.find((l) => l.accountId === cashId)?.creditAmount).toBe("25000.00");
  });

  it("refuses a payment whose allocations don't add up to its amount, or that exceed what is owed", async () => {
    await expect(pay(20000, [{ targetId: second, allocatedAmount: 5000 }])).rejects.toThrow(/full payment amount must be allocated/);
    await expect(pay(20000, [{ targetId: second, allocatedAmount: 20000 }])).rejects.toThrow(/outstanding balance/);
  });

  it("gives both expenses their money back when the payment is voided", async () => {
    await voidPayment(org.tenantId, paymentId, org.userId, "Entered by mistake");
    expect(await row(first)).toMatchObject({ status: "unpaid", amountPaid: "0.00" });
    expect(await row(second)).toMatchObject({ status: "unpaid", amountPaid: "0.00" });
  });
});
