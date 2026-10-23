import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, expenses, interTransfers, journalEntries, payments, purchaseBills, salesImports, salesInvoices, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { fullAccessPermissions } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import { createPayment } from "@/lib/ledger/payments-engine";
import { createTransfer } from "@/lib/ledger/inter-transfers";
import { postJournalEntry } from "@/lib/ledger/post";

// Server actions, called the way the browser calls them: with an id taken from the page. The session is organization A's
// (full permissions, so permission is not what stops these); the ids belong to organization B. Whatever the action does
// with them, B's data must be exactly as it was afterwards, and reads of B's records must come back empty.

let sessionTenantId = "";
let sessionUserId = "";
const session = (): AppSession => ({ userId: sessionUserId, tenantId: sessionTenantId, role: "owner", roleName: "Owner", permissions: fullAccessPermissions(), calendar: "AD" });

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, requireTenantSession: async () => session(), requireOrgAdmin: async () => session() };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); } }));

let A: Awaited<ReturnType<typeof createTempOrg>>;
let B: Awaited<ReturnType<typeof createTempOrg>>;
const b = {} as { cash: string; bank: string; customer: string; vendor: string; invoice: string; bill: string; expense: string; paymentId: string; entryId: string; transferId: string; importId: string };

const acct = async (tenantId: string, code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code))))[0];
const attempt = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
};
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
/** Everything of B's an action could change. */
const snapshotB = async () => {
  const one = async <T>(q: Promise<T[]>) => (await q)[0] ?? null;
  return {
    invoice: await one(db.select().from(salesInvoices).where(eq(salesInvoices.id, b.invoice))),
    bill: await one(db.select().from(purchaseBills).where(eq(purchaseBills.id, b.bill))),
    expense: await one(db.select().from(expenses).where(eq(expenses.id, b.expense))),
    customer: await one(db.select().from(customers).where(eq(customers.id, b.customer))),
    vendor: await one(db.select().from(vendors).where(eq(vendors.id, b.vendor))),
    cash: await one(db.select().from(accounts).where(eq(accounts.id, b.cash))),
    payment: await one(db.select().from(payments).where(eq(payments.id, b.paymentId))),
    entry: await one(db.select().from(journalEntries).where(eq(journalEntries.id, b.entryId))),
    transfer: await one(db.select().from(interTransfers).where(eq(interTransfers.id, b.transferId))),
    import: await one(db.select().from(salesImports).where(eq(salesImports.id, b.importId))),
    entryCount: (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, B.tenantId))).length,
  };
};

beforeAll(async () => {
  A = await createTempOrg("ZZ Action IDOR A");
  B = await createTempOrg("ZZ Action IDOR B");
  sessionTenantId = A.tenantId;
  sessionUserId = A.userId;
  b.cash = (await acct(B.tenantId, "1000")).id;
  b.bank = (await db.insert(accounts).values({ tenantId: B.tenantId, code: "1010.01", name: "B Bank", category: "asset", subCategory: "Current assets", parentAccountId: (await acct(B.tenantId, "1010")).id }).returning())[0].id;
  b.customer = (await db.insert(customers).values({ tenantId: B.tenantId, name: "B Customer" }).returning())[0].id;
  b.vendor = (await db.insert(vendors).values({ tenantId: B.tenantId, name: "B Supplier" }).returning())[0].id;
  b.invoice = (await db.insert(salesInvoices).values({ tenantId: B.tenantId, customerId: b.customer, invoiceNumber: "ZZ-B-1", invoiceDate: "2026-09-01", subtotal: "1000", total: "1000", status: "sent" }).returning())[0].id;
  b.bill = (await db.insert(purchaseBills).values({ tenantId: B.tenantId, vendorId: b.vendor, billNumber: "ZZ-B-BILL", billDate: "2026-09-01", subtotal: "500", total: "500", status: "open" }).returning())[0].id;
  b.expense = (
    await db
      .insert(expenses)
      .values({ tenantId: B.tenantId, expenseNumber: "ZZ-B-EXP", expenseDate: "2026-09-01", categoryAccountId: (await acct(B.tenantId, "5100")).id, taxableAmount: "100", subtotal: "100", total: "100", amountPayable: "100" })
      .returning()
  )[0].id;
  await createPayment(B.tenantId, B.userId, "TMP", { direction: "money_in", paymentType: "customer_payment", paymentDate: "2026-09-05", partyType: "customer", customerId: b.customer, accountId: b.cash, paymentMethod: "cash", amount: 300, confirmDuplicate: true });
  b.paymentId = (await db.select().from(payments).where(eq(payments.tenantId, B.tenantId)))[0].id;
  b.entryId = (await postJournalEntry({ tenantId: B.tenantId, entryDate: "2026-09-06", sourceType: "manual", createdBy: B.userId, lines: [{ accountId: b.cash, debitAmount: 80 }, { accountId: (await acct(B.tenantId, "4000")).id, creditAmount: 80 }] })).id;
  await createTransfer(B.tenantId, B.userId, { transferDate: "2026-09-07", fromAccountId: b.cash, toAccountId: b.bank, amount: 50 });
  b.transferId = (await db.select().from(interTransfers).where(eq(interTransfers.tenantId, B.tenantId)))[0].id;
  b.importId = (await db.insert(salesImports).values({ tenantId: B.tenantId, fileName: "b.xlsx" }).returning())[0].id;
});
afterAll(async () => {
  // rows the fixtures added directly, before the organization (and its cascades) goes
  if (B) {
    await db.delete(salesImports).where(eq(salesImports.tenantId, B.tenantId));
    await db.delete(expenses).where(eq(expenses.tenantId, B.tenantId));
  }
  await A?.remove();
  await B?.remove();
});

describe("a signed-in member of organization A cannot change organization B's records through server actions", () => {
  it("void invoice / bill / expense", async () => {
    const before = await snapshotB();
    const { voidInvoice } = await import("@/app/(app)/sales/actions");
    const { voidBill } = await import("@/app/(app)/purchases/actions");
    const { voidExpense } = await import("@/app/(app)/expenses/actions");
    await attempt(() => voidInvoice(form({ invoiceId: b.invoice, reason: "attack" })));
    await attempt(() => voidBill(form({ billId: b.bill, reason: "attack" })));
    await attempt(() => voidExpense(form({ expenseId: b.expense, reason: "attack" })));
    expect(await snapshotB()).toEqual(before);
  });

  it("void payment / inter-transfer, reverse journal entry", async () => {
    const before = await snapshotB();
    const { voidPayment } = await import("@/app/(app)/payments/actions");
    const { voidInterTransfer } = await import("@/app/(app)/payments/inter-transfer/actions");
    const { reverseEntry } = await import("@/app/(app)/journal/actions");
    await attempt(() => voidPayment(b.paymentId, "attack"));
    await attempt(() => voidInterTransfer(b.transferId, "attack"));
    await attempt(() => reverseEntry(form({ journalEntryId: b.entryId })));
    expect(await snapshotB()).toEqual(before);
  });

  it("delete customer / supplier / account", async () => {
    const before = await snapshotB();
    const { deleteCustomer } = await import("@/app/(app)/customers/actions");
    const { deleteSupplier } = await import("@/app/(app)/suppliers/actions");
    const { deleteAccount } = await import("@/app/(app)/chart-of-accounts/actions");
    await attempt(() => deleteCustomer(form({ customerId: b.customer })));
    await attempt(() => deleteSupplier(form({ supplierId: b.vendor })));
    await attempt(() => deleteAccount(b.bank));
    expect(await snapshotB()).toEqual(before);
  });

  it("undo B's import", async () => {
    const before = await snapshotB();
    const { undoImport } = await import("@/app/(app)/sales/import/actions");
    const r = (await attempt(() => undoImport(b.importId))) as { ok?: boolean };
    expect(r.ok).not.toBe(true);
    expect(await snapshotB()).toEqual(before);
  });

  it("reads of B's records come back empty", async () => {
    const { getInterTransferDetail } = await import("@/app/(app)/payments/inter-transfer/actions");
    const { getAssetDetailData } = await import("@/app/(app)/assets/actions");
    expect(await attempt(() => getInterTransferDetail(b.transferId))).toSatisfy((r: unknown) => r == null || r instanceof Error);
    expect(await attempt(() => getAssetDetailData("00000000-0000-0000-0000-000000000000"))).toSatisfy((r: unknown) => r == null || r instanceof Error);
  });
});
