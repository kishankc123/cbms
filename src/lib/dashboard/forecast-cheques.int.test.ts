import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, issuedCheques, purchaseBills, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { todayIso } from "@/lib/calendar";
import { chequeBankAccounts, issueCheque } from "@/lib/cheques/cheques";
import { addDays, loadForecast } from "./forecast";

// A cheque is the cash going out on its date, so a bill it covers is not forecast a second time on its due date.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let bankId: string;
let vendorId: string;
const today = todayIso();
const out = async (days = 40, extra?: Parameters<typeof loadForecast>[3]) => {
  const r = await loadForecast(org.tenantId, today, days, extra);
  const by = (key: string) => r.forecast.byCategory.find((c) => c.key === key)?.amount ?? 0;
  return { r, supplier: by("supplier_payments"), cheques: by("cheques"), totalOut: r.forecast.totalOut };
};
const bill = (n: string, due: number, total: number, billDaysAgo: number) =>
  db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId, billNumber: n, billDate: addDays(today, -billDaysAgo), dueDate: addDays(today, due), subtotal: String(total), taxAmount: "0", total: String(total), status: "open", amountPaid: "0", purchaseType: "credit" });
const cheque = (n: string, amount: number, dueIn: number) =>
  issueCheque(org.tenantId, org.userId, { bankAccountId: bankId, chequeNumber: n, payeeKind: "supplier", vendorId, expenseId: null, amount, issueDate: today, chequeDate: addDays(today, dueIn), memo: null, replacesId: null }, today);

beforeAll(async () => {
  org = await createTempOrg("ZZ Forecast Cheques");
  bankId = (await chequeBankAccounts(org.tenantId))[0].id;
  const [v] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Cover Supplier" }).returning();
  vendorId = v.id;
  const [equity] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "3000")));
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: bankId, debitAmount: 40000 }, { accountId: equity.id, creditAmount: 40000 }] });
  await bill("PB-1", 10, 30000, 30);
  await bill("PB-2", 20, 20000, 20);
});
afterAll(async () => {
  await db.delete(issuedCheques).where(eq(issuedCheques.tenantId, org.tenantId));
  await org.remove();
});

describe("cheques in the cash forecast", () => {
  it("forecasts the bills on their due dates when no cheque has been written", async () => {
    const f = await out();
    expect(f.supplier).toBe(50000);
    expect(f.cheques).toBe(0);
    expect(f.r.cheques.count).toBe(0);
  });

  it("swaps the bill a cheque covers for the cheque, so cash out is not counted twice", async () => {
    await cheque("000101", 30000, 10);
    const f = await out();
    expect(f.cheques).toBe(30000);
    expect(f.supplier).toBe(20000); // PB-1 (the oldest) is covered; PB-2 is still forecast
    expect(f.totalOut).toBe(50000);
    expect(f.r.cheques).toMatchObject({ count: 1, amount: 30000 });
  });

  it("covers the next bill part way when the cheque is smaller than what is owed", async () => {
    await cheque("000102", 10000, 20);
    const f = await out();
    expect(f.cheques).toBe(40000);
    expect(f.supplier).toBe(10000);
    expect(f.totalOut).toBe(50000);
  });

  it("flags a cheque the account is not expected to cover on its date", async () => {
    // Cash is 40,000 and 30,000 goes out on day 10, then 10,000 on day 20: covered. A third cheque of 25,000 on day 25 is not.
    await cheque("000103", 25000, 25);
    const f = await out();
    expect(f.r.cheques.atRisk.map((c) => c.chequeNumber)).toEqual(["000103"]);
    expect(f.r.cheques.atRisk[0].balance).toBeLessThan(0);
  });

  it("tries a cheque that is still being written, without saving it", async () => {
    const before = await out();
    const tried = await out(40, { extraCheques: [{ id: "draft", chequeNumber: "DRAFT", payeeKind: "supplier", vendorId, expenseId: null, payeeName: "Cover Supplier", amount: 5000, chequeDate: addDays(today, 5) }] });
    expect(tried.cheques).toBe(before.cheques + 5000);
    expect((await db.select().from(issuedCheques).where(eq(issuedCheques.tenantId, org.tenantId))).filter((c) => c.chequeNumber === "DRAFT")).toHaveLength(0);
  });

  it("stops counting a cheque once it is stopped", async () => {
    const [c] = await db.select().from(issuedCheques).where(and(eq(issuedCheques.tenantId, org.tenantId), eq(issuedCheques.chequeNumber, "000103")));
    await db.update(issuedCheques).set({ status: "stopped" }).where(eq(issuedCheques.id, c.id));
    const f = await out();
    // The stopped cheque is gone, so the part of PB-2 it covered is forecast on its due date again.
    expect(f.r.cheques.atRisk.map((c) => c.chequeNumber)).not.toContain("000103");
    expect(f.cheques).toBe(40000);
    expect(f.supplier).toBe(10000);
  });
});
