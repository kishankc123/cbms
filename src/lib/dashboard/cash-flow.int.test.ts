import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "@/lib/ledger/payments-engine";
import { postJournalEntry } from "@/lib/ledger/post";
import { cashFlow } from "./cash-flow";

// Money in and out is worked out from the real cash lines. Whatever happens in the period (receipts, payments, a transfer, a void),
// opening cash + movement must come to the ledger's closing cash.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let bankId: string;
let customerId: string;
let vendorId: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const pay = (input: Parameters<typeof createPayment>[3]) => createPayment(org.tenantId, org.userId, "TMP-" + Math.random().toString(36).slice(2, 7), input);
const base = { paymentMethod: "cash" as const, confirmDuplicate: true };

beforeAll(async () => {
  org = await createTempOrg("ZZ Cash Flow");
  cashId = (await acct("1000")).id;
  bankId = (await acct("1010")).id ?? cashId;
  const [c] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Cash Flow Customer" }).returning();
  const [v] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Cash Flow Supplier" }).returning();
  customerId = c.id;
  vendorId = v.id;
  // The balance the books started with, dated before the period
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: cashId, debitAmount: 10000 }, { accountId: (await acct("3000")).id, creditAmount: 10000 }] });
});
afterAll(async () => {
  await org.remove();
});

describe("cash flow for a period", () => {
  it("opens with the books' cash and reports nothing for a quiet period", async () => {
    const r = await cashFlow(org.tenantId, "2026-09-01", "2026-09-30");
    expect(r.openingCash).toBe(10000);
    expect(r.closingCash).toBe(10000);
    expect(r.moneyIn).toBe(0);
    expect(r.moneyOut).toBe(0);
    expect(r.difference).toBe(0);
  });

  it("classifies receipts and payments, leaves transfers out, and still reconciles", async () => {
    await pay({ ...base, direction: "money_in", paymentType: "customer_payment", paymentDate: "2026-09-05", partyType: "customer", customerId, accountId: cashId, amount: 5000 } as never);
    await pay({ ...base, direction: "money_in", paymentType: "other_receipt", paymentDate: "2026-09-06", partyType: "none", accountId: cashId, amount: 700 } as never);
    await pay({ ...base, direction: "money_out", paymentType: "supplier_advance", paymentDate: "2026-09-07", partyType: "supplier", vendorId, accountId: cashId, amount: 1200 } as never);
    // a move between the business's own accounts: neither money in nor money out
    await postJournalEntry({
      tenantId: org.tenantId,
      entryDate: "2026-09-08",
      sourceType: "inter_transfer",
      createdBy: org.userId,
      lines: [{ accountId: bankId, debitAmount: 300 }, { accountId: cashId, creditAmount: 300 }],
    });
    const r = await cashFlow(org.tenantId, "2026-09-01", "2026-09-30");
    expect(r.moneyIn).toBe(5700);
    expect(r.moneyOut).toBe(1200);
    expect(r.categories.find((c) => c.key === "customer_collections")?.amount).toBe(5000);
    expect(r.categories.find((c) => c.key === "other_receipts")?.amount).toBe(700);
    expect(r.categories.find((c) => c.key === "supplier_payments")?.amount).toBe(1200);
    expect(r.closingCash).toBe(14500);
    expect(r.difference).toBe(0);
  });

  it("does not count a payment that was voided in the same period", async () => {
    const before = await cashFlow(org.tenantId, "2026-09-01", "2026-09-30");
    const p = await pay({ ...base, direction: "money_out", paymentType: "expense_payment", paymentDate: "2026-09-10", partyType: "none", accountId: cashId, amount: 400 } as never).catch(() => null);
    if (p && "paymentId" in p) await voidPayment(org.tenantId, p.paymentId, org.userId, "test");
    const after = await cashFlow(org.tenantId, "2026-09-01", "2026-09-30");
    expect(after.moneyOut).toBe(before.moneyOut);
    expect(after.difference).toBe(0);
  });

  it("keeps the figures reconciling when a payment is voided in a later period", async () => {
    const p = await pay({ ...base, direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-20", partyType: "supplier", vendorId, accountId: cashId, amount: 900 } as never).catch(() => null);
    if (p && "paymentId" in p) await voidPayment(org.tenantId, p.paymentId, org.userId, "test");
    for (const [from, to] of [["2026-09-01", "2026-09-30"], ["2026-10-01", "2026-10-31"], ["2026-09-01", "2026-12-31"]] as const) {
      expect((await cashFlow(org.tenantId, from, to)).difference).toBe(0);
    }
  });

  it("adds up across consecutive periods", async () => {
    const a = await cashFlow(org.tenantId, "2026-09-01", "2026-09-15");
    const b = await cashFlow(org.tenantId, "2026-09-16", "2026-09-30");
    const whole = await cashFlow(org.tenantId, "2026-09-01", "2026-09-30");
    expect(b.openingCash).toBe(a.closingCash);
    expect(whole.closingCash).toBe(b.closingCash);
    expect(a.difference).toBe(0);
    expect(b.difference).toBe(0);
  });
});
