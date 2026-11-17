import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, journalLines, journalEntries, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createExpenseCore, type ExpenseInput } from "@/lib/expenses/expense-records";
import { moveExpensePayables } from "@/lib/expenses/move-payables";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { getOrCreateExpensePayableAccount } from "@/lib/ledger/expense-accounts";
import { payableAgeing } from "@/lib/ledger/payable-ageing";

// An unpaid expense with a supplier is owed on the supplier's own account, so it shows in their history and ageing.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let vendorId: string;
let payableId: string;
let categoryId: string;

const input = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  expenseDate: "2026-09-10", categoryAccountId: categoryId, vendorId, description: "Repair", invoiceNumber: "", invoiceDate: "", dueDate: "", billType: "no_bill", taxTreatment: "exempt",
  taxableAmount: 5000, vatAmount: 0, tdsAmount: 0, otherTaxAmount: 0, payments: [], ...over,
});

beforeAll(async () => {
  org = await createTempOrg("ZZ Expense Supplier");
  [{ id: vendorId }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Landlord Ltd" }).returning({ id: vendors.id });
  const find = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
  categoryId = (await find("5100")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("an unpaid expense with a supplier", () => {
  it("is owed on the supplier's own account and shows in their history and ageing", { timeout: 120000 }, async () => {
    const ctx = { tenantId: org.tenantId, userId: org.userId };
    const { expenseId, expenseNumber } = await createExpenseCore(ctx, input());
    const [e] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    expect(e.payableAccountId).toBeTruthy();
    payableId = e.payableAccountId!;
    const [v] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
    expect(v.payableAccountId).toBe(payableId);

    const lines = (await getPartyLines(org.tenantId, [payableId])).get(payableId)!;
    expect(lines).toMatchObject([{ sourceType: "expense", reference: expenseNumber, credit: 5000 }]);

    const ageing = await payableAgeing(org.tenantId, new Date("2026-11-17T00:00:00Z"));
    expect(ageing.rows.find((r) => r.vendorId === vendorId)).toMatchObject({ d61to90: 5000, unapplied: 0, total: 5000 });
  });

  it("an older expense still on Expense Payable is moved across, once, and the moved entry reverses cleanly", { timeout: 120000 }, async () => {
    const ctx = { tenantId: org.tenantId, userId: org.userId };
    const { expenseId } = await createExpenseCore(ctx, input({ taxableAmount: 700, description: "Older" }));
    // make it look like one entered before the change
    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, expenseId), eq(journalEntries.sourceType, "expense")));
    const ep = (await getOrCreateExpensePayableAccount(org.tenantId)).id;
    await db.update(journalLines).set({ accountId: ep }).where(and(eq(journalLines.journalEntryId, entry.id), eq(journalLines.accountId, payableId)));
    await db.update(expenses).set({ payableAccountId: null }).where(eq(expenses.id, expenseId));

    const preview = await moveExpensePayables({ tenantId: org.tenantId, apply: false });
    expect(preview.moved.map((m) => m.expenseId)).toEqual([expenseId]);
    expect(await moveExpensePayables({ tenantId: org.tenantId, apply: false })).toMatchObject({ skipped: [] });

    const done = await moveExpensePayables({ tenantId: org.tenantId, apply: true });
    expect(done.moved).toHaveLength(1);
    const [after] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    expect(after.payableAccountId).toBe(payableId);
    const net = async (id: string) => (await getPartyLines(org.tenantId, [id])).get(id)!.reduce((s, l) => s + l.credit - l.debit, 0);
    expect(await net(payableId)).toBe(5700); // both expenses now sit on the supplier's account
    expect(await net(ep)).toBe(0); // and nothing is left on Expense Payable
    expect((await moveExpensePayables({ tenantId: org.tenantId, apply: true })).moved).toHaveLength(0); // once only
  });
});
