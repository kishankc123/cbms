import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, recurringExpenseInstances } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createRecurringExpense, updateRecurringExpense, getRecurringExpenseById, bookedBefore, type RecurringExpenseInput } from "@/lib/recurring-expenses";
import { runRecurringExpenseEngine } from "@/lib/recurring-expenses/generate";

// Moving the start date of a recurring expense moves the schedule: back books the earlier months, forward drops them (booked ones are kept or voided).

let org: Awaited<ReturnType<typeof createTempOrg>>;
let categoryId: string;

const input = (over: Partial<RecurringExpenseInput> = {}): RecurringExpenseInput => ({
  expenseName: "Office rent", expenseAccountId: categoryId, vendorId: null, payeeName: null, amount: 40000, frequency: "monthly", customIntervalMonths: null,
  recognitionRule: "last_day", recognitionDay: null, dueRule: "same_day", dueRuleValue: null, startDate: "2026-09-01", endDate: null, priority: "normal",
  expectedPaymentAccountId: null, notes: null, ...over,
});
const TODAY = "2026-10-15";
const instances = async (id: string) => (await db.select().from(recurringExpenseInstances).where(eq(recurringExpenseInstances.recurringExpenseId, id))).sort((a, b) => a.expenseDate.localeCompare(b.expenseDate));
const live = async (id: string) => (await instances(id)).filter((i) => i.expenseId);

beforeAll(async () => {
  org = await createTempOrg("ZZ Recurring Start Change");
  categoryId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "5100"))))[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("moving the start date of a recurring expense", () => {
  it("back: the earlier month is booked the next time the engine runs", { timeout: 300000 }, async () => {
    const row = await createRecurringExpense(org.tenantId, org.userId, input({ startDate: "2026-09-01" }));
    await runRecurringExpenseEngine(org.tenantId, org.userId, "AD", TODAY);
    const before = (await live(row.id)).map((i) => i.periodKey);
    expect(before.length).toBeGreaterThan(0);

    await updateRecurringExpense(org.tenantId, org.userId, row.id, input({ startDate: "2026-08-01" }));
    expect((await getRecurringExpenseById(org.tenantId, row.id))?.effectiveFrom).toBe("2026-08-01");
    await runRecurringExpenseEngine(org.tenantId, org.userId, "AD", TODAY);
    const after = (await live(row.id)).map((i) => i.periodKey);
    expect(after.length).toBe(before.length + 1);
    expect(after).toContain("AD:2026-08");
  });

  it("forward: forecasts before the new start go; booked months are kept unless chosen for voiding", { timeout: 300000 }, async () => {
    const row = await createRecurringExpense(org.tenantId, org.userId, input({ expenseName: "Warehouse rent", startDate: "2026-08-01" }));
    await runRecurringExpenseEngine(org.tenantId, org.userId, "AD", TODAY);
    const booked = await live(row.id);
    expect(booked.map((i) => i.periodKey)).toEqual(["AD:2026-08", "AD:2026-09"]);

    // Keep: nothing is voided, the schedule starts later
    const found = await bookedBefore(org.tenantId, row.id, "2026-10-01");
    expect(found.map((b) => b.periodLabel).length).toBe(2);
    expect(found.every((b) => b.voidable)).toBe(true);
    await updateRecurringExpense(org.tenantId, org.userId, row.id, input({ expenseName: "Warehouse rent", startDate: "2026-09-01" }), []);
    expect((await live(row.id)).length).toBe(2);

    // Void the August month only
    const aug = found.find((b) => b.periodLabel.length > 0 && b.expenseDate < "2026-09-01")!;
    await updateRecurringExpense(org.tenantId, org.userId, row.id, input({ expenseName: "Warehouse rent", startDate: "2026-10-01" }), [aug.instanceId]);
    const [augExpense] = await db.select().from(expenses).where(eq(expenses.id, aug.expenseId));
    expect(augExpense.status).toBe("void");
    expect((await instances(row.id)).some((i) => i.id === aug.instanceId)).toBe(false);
    // September stays booked (it was not chosen)
    expect((await live(row.id)).map((i) => i.periodKey)).toContain("AD:2026-09");
  });

  it("refuses to void a month that has a payment against it, and changes nothing", { timeout: 300000 }, async () => {
    const row = await createRecurringExpense(org.tenantId, org.userId, input({ expenseName: "Store rent", startDate: "2026-08-01" }));
    await runRecurringExpenseEngine(org.tenantId, org.userId, "AD", TODAY);
    const first = (await live(row.id))[0];
    await db.update(expenses).set({ amountPaid: "100.00", status: "partially_paid" }).where(eq(expenses.id, first.expenseId!));
    await expect(updateRecurringExpense(org.tenantId, org.userId, row.id, input({ expenseName: "Store rent", startDate: "2026-10-01" }), [first.id])).rejects.toThrow(/payment/);
    expect((await getRecurringExpenseById(org.tenantId, row.id))?.effectiveFrom).toBe("2026-08-01");
    expect((await live(row.id)).length).toBe(2);
  });
});
