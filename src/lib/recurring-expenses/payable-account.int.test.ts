import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createRecurringExpense, updateRecurringExpense, getRecurringExpenseById, type RecurringExpenseInput } from "@/lib/recurring-expenses";
import { runRecurringExpenseEngine } from "@/lib/recurring-expenses/generate";
import { getPartyLines } from "@/lib/ledger/party-ledger";

// A recurring expense is owed on its own account under Recurring Payable, or on its supplier's account when it has a supplier.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let categoryId: string;
let vendorId: string;

const input = (over: Partial<RecurringExpenseInput> = {}): RecurringExpenseInput => ({
  expenseName: "Netflix subscription", expenseAccountId: categoryId, vendorId: null, payeeName: null, amount: 1500, frequency: "monthly", customIntervalMonths: null,
  recognitionRule: "last_day", recognitionDay: null, dueRule: "same_day", dueRuleValue: null, startDate: "2026-09-01", endDate: null, priority: "normal",
  expectedPaymentAccountId: null, notes: null, ...over,
});

beforeAll(async () => {
  org = await createTempOrg("ZZ Recurring Payable");
  categoryId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "5100"))))[0].id;
  [{ id: vendorId }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Ncell" }).returning({ id: vendors.id });
});
afterAll(async () => {
  await org.remove();
});

describe("where a recurring expense is owed", () => {
  it("without a supplier: its own account under Recurring Payable, named after it, renamed with it, and each occurrence is owed there", { timeout: 200000 }, async () => {
    const row = await createRecurringExpense(org.tenantId, org.userId, input());
    expect(row.payableAccountId).toBeTruthy();
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, row.payableAccountId!));
    const [group] = await db.select().from(accounts).where(eq(accounts.id, acct.parentAccountId!));
    expect([acct.name, acct.category, group.code, group.name]).toEqual(["Netflix subscription payable", "liability", "2345", "Recurring Payable"]);

    await runRecurringExpenseEngine(org.tenantId, org.userId, "AD", "2026-10-15");
    const made = await db.select().from(expenses).where(eq(expenses.tenantId, org.tenantId));
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((e) => e.payableAccountId === acct.id)).toBe(true);
    const lines = (await getPartyLines(org.tenantId, [acct.id])).get(acct.id)!;
    expect(lines.reduce((s, l) => s + l.credit, 0)).toBe(made.length * 1500);

    await updateRecurringExpense(org.tenantId, org.userId, row.id, input({ expenseName: "Netflix Premium" }));
    expect((await db.select().from(accounts).where(eq(accounts.id, acct.id)))[0].name).toBe("Netflix Premium payable");
  });

  it("with a supplier: the supplier's own account, and no account of its own is made", { timeout: 200000 }, async () => {
    const row = await createRecurringExpense(org.tenantId, org.userId, input({ expenseName: "Internet", vendorId }));
    expect(row.payableAccountId).toBeNull();
    await runRecurringExpenseEngine(org.tenantId, org.userId, "AD", "2026-10-15");
    const [v] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
    const mine = await db.select().from(expenses).where(and(eq(expenses.tenantId, org.tenantId), eq(expenses.vendorId, vendorId)));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.payableAccountId === v.payableAccountId)).toBe(true);
    expect((await getRecurringExpenseById(org.tenantId, row.id))?.payableAccountId).toBeNull();
  });
});
