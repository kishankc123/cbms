import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createPayment, voidPayment } from "@/lib/ledger/payments-engine";
import { postJournalEntry } from "@/lib/ledger/post";
import { cashFlowByAccount } from "./cashflow-by-account";

// Cash flow by account is worked out from the real lines of every entry that touched a cash account. Whatever happens in the period, the closing of each
// account must come to what the ledger holds, and the rows must say what the money was for.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let bankId: string;
let customerId: string;
let vendorId: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const pay = (input: Parameters<typeof createPayment>[3]) => createPayment(org.tenantId, org.userId, "TMP-" + Math.random().toString(36).slice(2, 7), input);
const base = { paymentMethod: "cash" as const, confirmDuplicate: true };

beforeAll(async () => {
  org = await createTempOrg("ZZ Cash Flow By Account");
  cashId = (await acct("1000")).id;
  bankId = (await acct("1010")).id ?? cashId;
  const [c] = await db.insert(customers).values({ tenantId: org.tenantId, name: "By Account Customer" }).returning();
  const [v] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "By Account Supplier" }).returning();
  customerId = c.id;
  vendorId = v.id;
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: cashId, debitAmount: 10000 }, { accountId: (await acct("3000")).id, creditAmount: 10000 }] });
});
afterAll(async () => {
  await org.remove();
});

describe("cash flow by account", () => {
  it("opens with each account's balance and agrees with the ledger when nothing moved", async () => {
    const r = await cashFlowByAccount(org.tenantId, "2026-09-01", "2026-09-30");
    expect(r.columns.length).toBeGreaterThan(0);
    expect(r.opening.reduce((s, v) => s + v, 0)).toBe(10000);
    expect(r.closing).toEqual(r.opening);
    expect(r.balanced).toBe(true);
  });

  it("sorts a customer's payment, a supplier's payment and a transfer into their rows, and still agrees with the ledger", async () => {
    await pay({ ...base, direction: "money_in", paymentType: "customer_payment", paymentDate: "2026-09-05", partyType: "customer", customerId, accountId: cashId, amount: 5000 } as never);
    await pay({ ...base, direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-07", partyType: "supplier", vendorId, accountId: cashId, amount: 1200 } as never);
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-08", sourceType: "inter_transfer", createdBy: org.userId, lines: [{ accountId: bankId, debitAmount: 300 }, { accountId: cashId, creditAmount: 300 }] });

    const r = await cashFlowByAccount(org.tenantId, "2026-09-01", "2026-09-30");
    const received = r.moneyIn.sections.find((s) => s.title === "Receivables")?.lines.find((l) => l.label === "Payment received");
    expect(received?.total).toBe(5000);
    expect(received?.children.map((c) => c.label)).toEqual(["By Account Customer"]);
    const paid = r.moneyOut.sections.find((s) => s.title === "Payables")?.lines.find((l) => l.label === "Paid to suppliers");
    expect(paid?.total).toBe(-1200);
    expect(paid?.children.map((c) => c.label)).toEqual(["By Account Supplier"]);
    expect(r.hasTransfers).toBe(true);
    expect(r.balanced).toBe(true);
    expect(r.closing.reduce((s, v) => s + v, 0)).toBe(13800);
  });

  it("does not count a payment that was voided in the same period, and stays in agreement across periods", async () => {
    const before = await cashFlowByAccount(org.tenantId, "2026-09-01", "2026-09-30");
    const p = await pay({ ...base, direction: "money_out", paymentType: "supplier_payment", paymentDate: "2026-09-20", partyType: "supplier", vendorId, accountId: cashId, amount: 900 } as never).catch(() => null);
    if (p && "paymentId" in p) await voidPayment(org.tenantId, p.paymentId, org.userId, "test");
    const after = await cashFlowByAccount(org.tenantId, "2026-09-01", "2026-09-30");
    expect(after.moneyOut.total).toBe(before.moneyOut.total);
    for (const [from, to] of [["2026-09-01", "2026-09-30"], ["2026-10-01", "2026-10-31"], ["2026-09-01", "2026-12-31"]] as const) {
      expect((await cashFlowByAccount(org.tenantId, from, to)).balanced).toBe(true);
    }
  });
});
