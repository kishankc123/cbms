import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, interTransfers, journalEntries, journalLines, payments, salesInvoices, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { createPayment, updatePayment, voidPayment } from "@/lib/ledger/payments-engine";
import { createTransfer, voidTransfer } from "@/lib/ledger/inter-transfers";
import { journalEntryDetail } from "@/lib/ledger/entry-detail";
import { entryInScope } from "@/lib/ledger/entry-access";
import { assertSupplierOwned } from "@/lib/ledger/account-guards";
import { generalLedger, trialBalance } from "@/lib/ledger/reports";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { postSalesBatch } from "@/lib/sales/invoice-records";

// Tenant isolation, database layer. Two throwaway organizations: B owns a customer, a supplier, accounts, an invoice,
// a payment, a transfer and a journal entry. Everything below acts as organization A (A's tenantId, the way every
// server action does after reading the session) and tries to read, change or use B's records by their ids.
//
// The assertions that matter are about B's data: it must be exactly as it was. Whether A's attempt is refused with
// an error or with a "not found" is secondary, so a refusal is tolerated in either form (`attempt`).

let A: Awaited<ReturnType<typeof createTempOrg>>;
let B: Awaited<ReturnType<typeof createTempOrg>>;
const b = {} as {
  cash: string;
  bank: string;
  customer: string;
  vendor: string;
  invoice: string;
  paymentId: string;
  entryId: string;
  transferId: string;
};
let aCash: string;

const acct = async (tenantId: string, code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code))))[0];
/** Runs an attempt that must not succeed; swallows the refusal, whatever form it takes. */
const attempt = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
};
const countOf = async (tenantId: string) => ({
  entries: (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId))).length,
  payments: (await db.select().from(payments).where(eq(payments.tenantId, tenantId))).length,
  invoices: (await db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenantId))).length,
});
/** A snapshot of everything of B's that an attack could change. */
const snapshotB = async () => ({
  counts: await countOf(B.tenantId),
  payment: (await db.select().from(payments).where(eq(payments.id, b.paymentId)))[0],
  entry: (await db.select().from(journalEntries).where(eq(journalEntries.id, b.entryId)))[0],
  transfer: (await db.select().from(interTransfers).where(eq(interTransfers.id, b.transferId)))[0],
  invoice: (await db.select().from(salesInvoices).where(eq(salesInvoices.id, b.invoice)))[0],
  lines: (await db.select().from(journalLines).where(eq(journalLines.journalEntryId, b.entryId))).length,
});

beforeAll(async () => {
  A = await createTempOrg("ZZ Isolation A");
  B = await createTempOrg("ZZ Isolation B");
  aCash = (await acct(A.tenantId, "1000")).id;
  b.cash = (await acct(B.tenantId, "1000")).id;
  b.bank = (
    await db
      .insert(accounts)
      .values({ tenantId: B.tenantId, code: "1010.01", name: "B Bank", category: "asset", subCategory: "Current assets", parentAccountId: (await acct(B.tenantId, "1010")).id })
      .returning()
  )[0].id;
  b.customer = (await db.insert(customers).values({ tenantId: B.tenantId, name: "B Customer" }).returning())[0].id;
  b.vendor = (await db.insert(vendors).values({ tenantId: B.tenantId, name: "B Supplier" }).returning())[0].id;
  b.invoice = (
    await db.insert(salesInvoices).values({ tenantId: B.tenantId, customerId: b.customer, invoiceNumber: "ZZ-B-1", invoiceDate: "2026-09-01", subtotal: "1000", total: "1000", status: "sent" }).returning()
  )[0].id;
  const made = await createPayment(B.tenantId, B.userId, "TMP", {
    direction: "money_in",
    paymentType: "customer_payment",
    paymentDate: "2026-09-05",
    partyType: "customer",
    customerId: b.customer,
    accountId: b.cash,
    paymentMethod: "cash",
    amount: 300,
    confirmDuplicate: true,
  });
  if (!("paymentId" in made) && !("payment" in made)) throw new Error("setup: B's payment was not created");
  b.paymentId = (await db.select().from(payments).where(eq(payments.tenantId, B.tenantId)))[0].id;
  b.entryId = (
    await postJournalEntry({
      tenantId: B.tenantId,
      entryDate: "2026-09-06",
      sourceType: "manual",
      createdBy: B.userId,
      lines: [
        { accountId: b.cash, debitAmount: 80 },
        { accountId: (await acct(B.tenantId, "4000")).id, creditAmount: 80 },
      ],
    })
  ).id;
  await createTransfer(B.tenantId, B.userId, { transferDate: "2026-09-07", fromAccountId: b.cash, toAccountId: b.bank, amount: 50 });
  b.transferId = (await db.select().from(interTransfers).where(eq(interTransfers.tenantId, B.tenantId)))[0].id;
});
afterAll(async () => {
  await A?.remove();
  await B?.remove();
});

describe("organization A cannot reach organization B's records by id", () => {
  it("cannot open B's journal entry", async () => {
    expect(await journalEntryDetail(A.tenantId, b.entryId)).toBeNull();
    for (const scope of ["ledger", "bank", "sales", "purchases"] as const) expect(await entryInScope(A.tenantId, b.entryId, scope).catch(() => false)).toBe(false);
  });

  it("cannot reverse B's journal entry", async () => {
    const before = await snapshotB();
    await attempt(() => reverseJournalEntry(A.tenantId, b.entryId, A.userId, "attack"));
    expect(await snapshotB()).toEqual(before);
  });

  it("cannot void or edit B's payment", async () => {
    const before = await snapshotB();
    await attempt(() => voidPayment(A.tenantId, b.paymentId, A.userId, "attack"));
    await attempt(() =>
      updatePayment(A.tenantId, A.userId, b.paymentId, { paymentDate: "2026-09-05", partyType: "customer", customerId: b.customer, accountId: aCash, paymentMethod: "cash", amount: 1 })
    );
    expect(await snapshotB()).toEqual(before);
  });

  it("cannot void B's inter-transfer", async () => {
    const before = await snapshotB();
    await attempt(() => voidTransfer(A.tenantId, A.userId, b.transferId, "attack"));
    expect(await snapshotB()).toEqual(before);
  });

  it("cannot see B's supplier", async () => {
    await expect(assertSupplierOwned(A.tenantId, b.vendor)).rejects.toThrow();
  });

  it("sees none of B's activity in its reports", async () => {
    const tb = await trialBalance(A.tenantId, new Date("2030-01-01"));
    const total = JSON.stringify(tb);
    expect(total).not.toContain(b.cash);
    await expect(generalLedger(A.tenantId, b.cash, new Date("2026-01-01"), new Date("2030-01-01"))).rejects.toThrow();
    const lines = await getPartyLines(A.tenantId, [b.cash, b.bank]);
    expect([...lines.values()].flat()).toEqual([]);
  });
});

describe("organization A cannot use B's records inside its own documents", () => {
  it("cannot post a journal entry onto B's account", async () => {
    const before = await countOf(A.tenantId);
    await expect(
      postJournalEntry({
        tenantId: A.tenantId,
        entryDate: "2026-09-08",
        sourceType: "manual",
        createdBy: A.userId,
        lines: [
          { accountId: aCash, debitAmount: 10 },
          { accountId: b.cash, creditAmount: 10 },
        ],
      })
    ).rejects.toThrow();
    expect(await countOf(A.tenantId)).toEqual(before);
  });

  it("cannot record a payment from B's customer, into B's account, or against B's invoice", async () => {
    const before = await snapshotB();
    const beforeA = await countOf(A.tenantId);
    const base = { direction: "money_in" as const, paymentType: "customer_payment" as const, paymentDate: "2026-09-09", partyType: "customer" as const, paymentMethod: "cash" as const, amount: 25, confirmDuplicate: true };
    const make = (over: Record<string, unknown>) => attempt(() => createPayment(A.tenantId, A.userId, "TMP", { ...base, customerId: b.customer, accountId: aCash, ...over } as Parameters<typeof createPayment>[3]));
    await make({}); // B's customer
    await make({ accountId: b.cash }); // B's account
    await make({ allocations: [{ targetType: "sales_invoice", targetId: b.invoice, allocatedAmount: 25 }] }); // B's invoice
    expect(await snapshotB()).toEqual(before);
    expect(await countOf(A.tenantId)).toEqual(beforeA);
  });

  it("cannot move money to or from B's accounts with an inter-transfer", async () => {
    const before = await snapshotB();
    const beforeA = await countOf(A.tenantId);
    await attempt(() => createTransfer(A.tenantId, A.userId, { transferDate: "2026-09-09", fromAccountId: aCash, toAccountId: b.bank, amount: 5 }));
    await attempt(() => createTransfer(A.tenantId, A.userId, { transferDate: "2026-09-09", fromAccountId: b.cash, toAccountId: aCash, amount: 5 }));
    expect(await snapshotB()).toEqual(before);
    expect(await countOf(A.tenantId)).toEqual(beforeA);
  });

  it("cannot invoice B's customer or book revenue to B's account", async () => {
    const before = await snapshotB();
    const beforeA = await countOf(A.tenantId);
    const row = { invoiceDate: "2026-09-10", grossAmount: 100, discountAmount: 0, billType: "zero_rated" as const, payments: [] };
    await attempt(() => postSalesBatch({ tenantId: A.tenantId, userId: A.userId }, [{ ...row, customerId: b.customer }]));
    expect(await snapshotB()).toEqual(before);
    expect(await countOf(A.tenantId), "an invoice for B's customer was created in A").toEqual(beforeA);
  });
});
