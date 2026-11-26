import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createExpenseCore, type ExpenseInput } from "@/lib/expenses/expense-records";
import { createPayment } from "./payments-engine";
import { cashWorkspace } from "./cash-reconcile";

// On the reconciliation screens an expense, and the payment of one, is shown with what it was for, not only its number.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashAccountId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];

beforeAll(async () => {
  org = await createTempOrg("ZZ Expense Text");
  const cashId = (await acct("1000")).id;
  const misc = (await acct("5900")).id;
  cashAccountId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: cashId }).returning())[0].id;
  const supplier = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Hall owner" }).returning())[0].id;
  const base: ExpenseInput = { expenseDate: "2026-09-01", categoryAccountId: misc, vendorId: supplier, description: "Hall rent for Shrawan", invoiceNumber: "", invoiceDate: "", dueDate: "", billType: "no_bill", taxTreatment: "taxable", taxableAmount: 5000, vatAmount: 0, tdsAmount: 0, otherTaxAmount: 0, payments: [] };
  // one paid on the spot, one paid later by a payment
  await createExpenseCore({ tenantId: org.tenantId, userId: org.userId }, { ...base, vendorId: null, description: "Courier charge", taxableAmount: 200, payments: [{ accountId: cashId, amount: 200 }] });
  const later = await createExpenseCore({ tenantId: org.tenantId, userId: org.userId }, base);
  await createPayment(org.tenantId, org.userId, "TMP", { direction: "money_out", paymentType: "expense_payment", paymentDate: "2026-09-10", partyType: "supplier", vendorId: supplier, accountId: cashId, paymentMethod: "cash", amount: 5000, confirmDuplicate: true, allocations: [{ targetType: "expense", targetId: later.expenseId, allocatedAmount: 5000 }] });
});
afterAll(async () => {
  await org.remove();
});

describe("expense entries on the cash reconciliation screen", () => {
  it("shows what each expense, and each expense payment, was for", async () => {
    const ws = await cashWorkspace(org.tenantId, cashAccountId, "2026-09-30");
    const labels = ws.lines.map((l) => l.label);
    expect(labels.some((l) => /Courier charge$/.test(l))).toBe(true);
    expect(labels.some((l) => /Payment made — Hall rent for Shrawan$/.test(l))).toBe(true);
  });
});
