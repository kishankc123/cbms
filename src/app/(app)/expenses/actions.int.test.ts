import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, accounts, customers, expenses, journalEntries, journalLines, purchaseBills, purchaseReturns, salesInvoices, salesReturns, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getVatReturn } from "@/lib/compliance/reports";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createExpense, recordExpensePayment } = await import("./actions");

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0);
}
const rows = () => db.select().from(expenses).where(eq(expenses.tenantId, org.tenantId));

let rentId: string;
let cashId: string;
let supplierId: string;
const base = () => ({
  expenseDate: "2026-09-01",
  categoryAccountId: rentId,
  vendorId: supplierId as string | null,
  description: "Rent",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  billType: "vat" as "vat" | "no_bill" | "pan",
  taxTreatment: "taxable" as const,
  taxableAmount: 1000,
  vatAmount: 130,
  tdsAmount: 0,
  otherTaxAmount: 0,
  payments: [] as { accountId: string; amount: number }[],
});

beforeAll(async () => {
  org = await createTempOrg("ZZ Expenses Test");
  rentId = (await acct("5100")).id;
  supplierId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Landlord Ltd" }).returning())[0].id;
  cashId = (await acct("1000")).id;
});
afterAll(async () => {
  await org.remove();
});

describe("expenses", () => {
  it("VAT is part of the cost until the organization is VAT-registered, then it is claimed", async () => {
    await createExpense(base());
    expect(await balance("5100")).toBe(1130);
    expect(await balance("1300")).toBe(0);

    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    await createExpense({ ...base(), invoiceNumber: "R-2" });
    expect(await balance("5100")).toBe(1130 + 1000);
    expect(await balance("1300")).toBe(130);
  });

  it("numbers expenses uniquely", async () => {
    await createExpense(base());
    const numbers = (await rows()).map((r) => r.expenseNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("refuses VAT on an exempt expense, a due date before the invoice, and bad accounts", async () => {
    await expect(createExpense({ ...base(), taxTreatment: "exempt" })).rejects.toThrow(/exempt/);
    await expect(createExpense({ ...base(), invoiceDate: "2026-09-05", dueDate: "2026-09-01" })).rejects.toThrow(/due date/);
    // a payment must come from a Cash/Bank account, not, say, the rent account
    await expect(createExpense({ ...base(), vatAmount: 0, billType: "no_bill", payments: [{ accountId: rentId, amount: 1000 }] })).rejects.toThrow(/Cash or Bank/);
  });

  it("the same supplier invoice is refused twice", async () => {
    await createExpense({ ...base(), invoiceNumber: "E-77" });
    await expect(createExpense({ ...base(), invoiceNumber: "E-77" })).rejects.toThrow(/already been recorded/);
  });

  it("a supplier is needed only while something is unpaid, and VAT only on a VAT bill", async () => {
    const noSupplier = { ...base(), vendorId: null, billType: "no_bill" as const, vatAmount: 0, taxableAmount: 300 };
    await expect(createExpense(noSupplier)).rejects.toThrow(/Select a supplier/);
    await createExpense({ ...noSupplier, payments: [{ accountId: cashId, amount: 300 }], billAvailable: false });
    const saved = (await rows()).find((r) => r.vendorId === null)!;
    expect(saved.billType).toBe("no_bill");
    expect(saved.billAvailable).toBe(false);
    await expect(createExpense({ ...base(), billType: "pan", vatAmount: 13 })).rejects.toThrow(/bill type is VAT/);
  });

  it("a locked period refuses the expense and leaves nothing behind", async () => {
    await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: "2026-01-01", periodEnd: "2026-01-31", label: "Jan (test)", status: "closed" });
    const before = (await rows()).length;
    await expect(createExpense({ ...base(), expenseDate: "2026-01-15", invoiceNumber: "LOCK-1" })).rejects.toThrow(/closed period/);
    expect((await rows()).length).toBe(before);
  });

  it("an expense payment carries its own date, and can't be dated before the expense or in the future", async () => {
    await createExpense({ ...base(), billType: "no_bill", description: "Cleaner", vatAmount: 0, taxableAmount: 500 });
    const e = (await rows()).find((r) => r.description === "Cleaner")!;
    await expect(recordExpensePayment({ expenseId: e.id, payments: [{ accountId: cashId, amount: 200 }], paymentDate: "2026-08-01" })).rejects.toThrow(/before the expense date/);
    await expect(recordExpensePayment({ expenseId: e.id, payments: [{ accountId: cashId, amount: 200 }], paymentDate: "2099-01-01" })).rejects.toThrow(/future/);
    await recordExpensePayment({ expenseId: e.id, payments: [{ accountId: cashId, amount: 200 }], paymentDate: "2026-09-03" });
    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, e.id), eq(journalEntries.sourceType, "payment")));
    expect(entry.entryDate).toBe("2026-09-03");
  });
});

describe("expense categories", () => {
  it("offers only the lowest level: a category with sub-categories can't be chosen, its sub-categories can", async () => {
    const utilities = await acct("5300");
    const child = await createSubAccount(org.tenantId, utilities, "Electricity");
    const offered = await getExpenseCategoryAccounts(org.tenantId);
    expect(offered.some((a) => a.id === utilities.id)).toBe(false);
    const c = offered.find((a) => a.id === child.id);
    expect(c?.group).toContain("Utilities");

    await expect(createExpense({ ...base(), categoryAccountId: utilities.id, invoiceNumber: "CAT-1" })).rejects.toThrow(/sub-categor/);
    await createExpense({ ...base(), categoryAccountId: child.id, invoiceNumber: "CAT-2" });
  });
});

describe("VAT return", () => {
  it("counts expense VAT as input VAT and takes returns off output and input VAT", async () => {
    const [customer] = await db.insert(customers).values({ tenantId: org.tenantId, name: "C" }).returning();
    const [vendor] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "V" }).returning();
    const d = "2027-03-10";
    await db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId: customer.id, invoiceNumber: "V-1", invoiceDate: d, subtotal: "1000", taxAmount: "130", total: "1130", status: "sent" });
    await db.insert(salesReturns).values({ tenantId: org.tenantId, customerId: customer.id, noteNumber: "V-R1", noteDate: d, subtotal: "200", taxAmount: "26", total: "226" });
    await db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId: vendor.id, billNumber: "V-B1", billDate: d, subtotal: "500", taxAmount: "65", total: "565", status: "open" });
    await db.insert(purchaseReturns).values({ tenantId: org.tenantId, vendorId: vendor.id, noteNumber: "V-P1", noteDate: d, subtotal: "100", taxAmount: "13", total: "113" });
    await db.insert(expenses).values({
      tenantId: org.tenantId, expenseNumber: "EXP-9001", expenseDate: d, categoryAccountId: rentId, payeeName: "X",
      taxableAmount: "100", vatAmount: "13", subtotal: "100", total: "113", amountPayable: "113",
    });

    const r = await getVatReturn(org.tenantId, "2027-03-01", "2027-03-31");
    expect(r.outputVat).toBe(130 - 26);
    expect(r.inputVat).toBe(65 + 13 - 13);
    expect(r.netVatPayable).toBe(104 - 65);
    expect(r.breakdown).toMatchObject({ salesReturnsVat: 26, expensesVat: 13, purchaseReturnsVat: 13 });
  });
});
