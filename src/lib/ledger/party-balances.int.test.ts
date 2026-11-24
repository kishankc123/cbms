import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, supplierReconciliations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment } from "@/lib/ledger/payments-engine";
import { postJournalEntry } from "@/lib/ledger/post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { tradePayables, tradeReceivables } from "./party-balances";

// Trade payables and receivables come from each party's own ledger account, and their total is held against the control account (Accounts Payable /
// Receivable) so an entry posted past the parties shows up as a difference.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let vendorId: string;
let customerId: string;
let cashSaleId: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const pay = (input: Parameters<typeof createPayment>[3]) => createPayment(org.tenantId, org.userId, "TMP-" + Math.random().toString(36).slice(2, 7), input);
const base = { paymentMethod: "cash" as const, confirmDuplicate: true };

beforeAll(async () => {
  org = await createTempOrg("ZZ Party Balances");
  cashId = (await acct("1000")).id;
  const [v] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Balance Supplier" }).returning();
  const [c] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Balance Customer" }).returning();
  const [cs] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Cash Sale" }).returning();
  vendorId = v.id;
  customerId = c.id;
  cashSaleId = cs.id;
  const ap = await getOrCreateSupplierPayableAccountId(org.tenantId, vendorId);
  const ar = await getOrCreateCustomerReceivableAccountId(org.tenantId, customerId);
  const arCash = await getOrCreateCustomerReceivableAccountId(org.tenantId, cashSaleId);
  const equity = (await acct("3000")).id;
  const expense = (await acct("5100")).id;
  const revenue = (await acct("4000")).id;
  // what was owed at the start of the books, then a bill in the period
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: equity, debitAmount: 1000 }, { accountId: ap, creditAmount: 1000 }] });
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-05", sourceType: "purchase", referenceNumber: "B-1", createdBy: org.userId, lines: [{ accountId: expense, debitAmount: 400 }, { accountId: ap, creditAmount: 400 }] });
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-06", sourceType: "sale", referenceNumber: "S-1", createdBy: org.userId, lines: [{ accountId: ar, debitAmount: 900 }, { accountId: revenue, creditAmount: 900 }] });
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-06", sourceType: "sale", referenceNumber: "S-2", createdBy: org.userId, lines: [{ accountId: arCash, debitAmount: 200 }, { accountId: revenue, creditAmount: 200 }] });
});
afterAll(async () => {
  await org.remove();
});

describe("trade payables", () => {
  it("rolls a supplier forward from the opening to the closing, and agrees with Accounts Payable", async () => {
    await pay({ ...base, direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-10", partyType: "supplier", vendorId, accountId: cashId, amount: 300 } as never);
    const r = await tradePayables(org.tenantId, "2026-09-01", "2026-09-30");
    const row = r.rows.find((x) => x.id === vendorId)!;
    expect(row.opening).toBe(1000);
    expect([row.inv, row.pay, row.ret, row.other]).toEqual([400, -300, 0, 0]);
    expect(row.closing).toBe(1100);
    expect(row.entries.at(-1)!.balance).toBe(1100);
    expect(r.check.balanced).toBe(true);
    expect(r.totals.closing).toBe(1100);
  });

  it("opens from the next period with the closing of the one before", async () => {
    const r = await tradePayables(org.tenantId, "2026-10-01", "2026-10-31");
    const row = r.rows.find((x) => x.id === vendorId)!;
    expect(row.opening).toBe(1100);
    expect(row.entries).toHaveLength(0);
    expect(row.closing).toBe(1100);
  });

  it("shows the supplier reconciliation status of each supplier", async () => {
    const before = await tradePayables(org.tenantId, "2026-09-01", "2026-09-30");
    expect(before.recon![vendorId]).toEqual({ state: "unreconciled", through: null });
    await db.insert(supplierReconciliations).values({ tenantId: org.tenantId, vendorId, fromDate: "2026-09-01", toDate: "2026-09-30", status: "draft" });
    expect((await tradePayables(org.tenantId, "2026-09-01", "2026-09-30")).recon![vendorId].state).toBe("in_progress");
    await db.update(supplierReconciliations).set({ status: "reconciled" }).where(eq(supplierReconciliations.vendorId, vendorId));
    expect((await tradePayables(org.tenantId, "2026-09-01", "2026-09-30")).recon![vendorId]).toEqual({ state: "reconciled", through: "2026-09-30" });
    // a later period the reconciliation does not reach is not reconciled, and says how far it was
    expect((await tradePayables(org.tenantId, "2026-11-01", "2026-11-30")).recon![vendorId]).toEqual({ state: "unreconciled", through: "2026-09-30" });
  });

  it("an entry posted straight to Accounts Payable shows as a difference", async () => {
    const ap = await acct("2000");
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-20", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: (await acct("3000")).id, debitAmount: 50 }, { accountId: ap.id, creditAmount: 50 }] });
    const r = await tradePayables(org.tenantId, "2026-09-01", "2026-09-30");
    expect(r.check.balanced).toBe(false);
    expect(r.check.difference).toBe(50);
  });
});

describe("trade receivables", () => {
  it("leaves the Cash Sale customer out of the table but counts it in the check, unless asked to include it", async () => {
    const r = await tradeReceivables(org.tenantId, "2026-09-01", "2026-09-30");
    expect(r.rows.map((x) => x.name)).toEqual(["Balance Customer"]);
    expect(r.rows[0].inv).toBe(900);
    expect(r.rows[0].closing).toBe(900);
    expect(r.leftOut).toMatchObject({ closing: 200 });
    expect(r.check.balanced).toBe(true);
    const withCash = await tradeReceivables(org.tenantId, "2026-09-01", "2026-09-30", { includeCashSale: true });
    expect(withCash.rows.map((x) => x.name).sort()).toEqual(["Balance Customer", "Cash Sale"]);
    expect(withCash.leftOut).toBeNull();
    expect(withCash.totals.closing).toBe(1100);
  });
});
