import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, issuedCheques, payments, receivedCheques } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listModeOptions, seedPaymentModes } from "@/lib/payment-modes";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { loadDaybook, loadDaybookPage, loadDaybookRange } from "./daybook";
import { loadCashCounts, saveCashCount } from "./cash-count";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let acct: Record<string, string>;
let cashMode: string;
let bankMode: string;
const DAY = "2026-11-02";
const BEFORE = "2026-11-01";
const invoiceId = randomUUID();

const post = (entryDate: string, sourceType: Parameters<typeof postJournalEntry>[0]["sourceType"], sourceId: string | undefined, lines: Parameters<typeof postJournalEntry>[0]["lines"]) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate, sourceType, sourceId, createdBy: org.userId, lines });

beforeAll(async () => {
  org = await createTempOrg("ZZ Daybook");
  await seedPaymentModes(org.tenantId);
  const rows = await db.select().from(accounts).where(eq(accounts.tenantId, org.tenantId));
  acct = Object.fromEntries(rows.map((a) => [a.code, a.id]));
  const options = await listModeOptions(org.tenantId);
  cashMode = options.find((m) => m.name === "Cash")!.id;
  bankMode = options.find((m) => m.name === "Bank transfer")!.id;

  await post(BEFORE, "manual", undefined, [{ accountId: acct["1000"], debitAmount: 5000, paymentModeId: cashMode }, { accountId: acct["1010"], debitAmount: 20000, paymentModeId: bankMode }, { accountId: acct["3000"], creditAmount: 25000 }]);
  // the day: an invoice of 1000 (600 cash and 200 bank received with it, 200 on credit), a cash expense of 150, 300 moved from bank to cash
  await post(DAY, "sale", invoiceId, [{ accountId: acct["1100"], debitAmount: 1000 }, { accountId: acct["4000"], creditAmount: 1000 }]);
  await post(DAY, "receipt", invoiceId, [{ accountId: acct["1000"], debitAmount: 600, paymentModeId: cashMode }, { accountId: acct["1010"], debitAmount: 200, paymentModeId: bankMode }, { accountId: acct["1100"], creditAmount: 800 }]);
  await post(DAY, "expense", randomUUID(), [{ accountId: acct["5100"], debitAmount: 150 }, { accountId: acct["1000"], creditAmount: 150, paymentModeId: cashMode }]);
  await post(DAY, "inter_transfer", randomUUID(), [{ accountId: acct["1000"], debitAmount: 300, paymentModeId: cashMode }, { accountId: acct["1010"], creditAmount: 300, paymentModeId: bankMode }]);
});
afterAll(async () => {
  await org.remove();
});

describe("the daybook of a day, from the real ledger", () => {
  it("shows the day's sales and expenses by mode, and cash and bank opening and closing that agree with the ledger", async () => {
    const d = await loadDaybook(org.tenantId, DAY);
    expect(d.sales.total).toBe(1000);
    expect(d.sales.byMode).toEqual([{ mode: "Cash", amount: 600 }, { mode: "Bank transfer", amount: 200 }, { mode: "On credit", amount: 200 }]);
    expect(d.expenses.byMode).toEqual([{ mode: "Cash", amount: 150 }]);
    expect(d.moneyIn).toBe(800);
    expect(d.moneyOut).toBe(150);
    expect(d.transfersMoved).toBe(300);

    const cash = d.accounts.find((a) => a.code === "1000")!;
    const bank = d.accounts.find((a) => a.code === "1010")!;
    expect(cash).toMatchObject({ opening: 5000, in: 600, out: 150, transfers: 300, closing: 5750 });
    expect(bank).toMatchObject({ opening: 20000, in: 200, out: 0, transfers: -300, closing: 19900 });
    expect(d.reconciles).toBe(true);
  });

  it("the day before shows the same balances as this day's opening, and an unused day carries them through", async () => {
    const earlier = await loadDaybook(org.tenantId, BEFORE);
    expect(earlier.totals.closing).toBe(25000);
    expect((await loadDaybook(org.tenantId, DAY)).totals.opening).toBe(25000);
    const later = await loadDaybook(org.tenantId, "2026-11-05");
    expect(later).toMatchObject({ moneyIn: 0, moneyOut: 0, totals: { opening: 25650, closing: 25650 } });
    expect(later.totals.opening).toBe(later.totals.closing);
  });

  it("the page also gives the month so far, collections and payments, the credit given and the entries of the day", async () => {
    const base = { tenantId: org.tenantId, createdBy: org.userId, accountId: acct["1000"], paymentMethod: "cash" as const };
    await db.insert(payments).values([
      { ...base, paymentNumber: "DB-1", direction: "money_in", paymentType: "customer_payment", paymentDate: DAY, amount: "500" },
      { ...base, paymentNumber: "DB-2", direction: "money_in", paymentType: "customer_payment", paymentDate: BEFORE, amount: "250" },
      { ...base, paymentNumber: "DB-3", direction: "money_out", paymentType: "salary_payment", paymentDate: BEFORE, amount: "900" },
      { ...base, paymentNumber: "DB-4", direction: "money_in", paymentType: "customer_payment", paymentDate: DAY, amount: "70", origin: "embedded" },
      { ...base, paymentNumber: "DB-5", direction: "money_in", paymentType: "customer_payment", paymentDate: DAY, amount: "60", status: "voided" },
      { ...base, paymentNumber: "DB-6", direction: "money_in", paymentType: "customer_payment", paymentDate: "2026-10-31", amount: "40" },
    ]);
    const p = await loadDaybookPage(org.tenantId, DAY, DAY, BEFORE);
    expect(p.book.sales.total).toBe(1000);
    expect(p.month).toMatchObject({ from: BEFORE, sales: 1000, expenses: 150 });
    expect(p.flows.find((r) => r.key === "recovered")).toMatchObject({ today: 500, month: 750 });
    expect(p.flows.find((r) => r.key === "salary")).toMatchObject({ today: 0, month: 900 });
    expect(p.flows.find((r) => r.key === "suppliers")).toMatchObject({ today: 0, month: 0 });
    expect(p.credit.given).toBe(200);
    expect(p.list.some((r) => r.kind === "Sale" && r.amount === 1000)).toBe(true);
  });

  it("a range agrees with the single days it is made of", async () => {
    const r = await loadDaybookRange(org.tenantId, BEFORE, "2026-11-04");
    expect(r.days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    const day = await loadDaybook(org.tenantId, DAY);
    const row = r.days.find((d) => d.day === DAY)!;
    expect(row).toMatchObject({ sales: day.sales.total, expenses: day.expenses.total, moneyIn: day.moneyIn, moneyOut: day.moneyOut, closing: day.totals.closing });
    expect(r.total.totals.opening).toBe(0);
    expect(r.total.reconciles).toBe(true);
    expect(r.days[r.days.length - 1].closing).toBe(r.total.totals.closing);
  });

  it("the page lists the cheques dated, paid or stopped on the day, and the late ones only for today", async () => {
    const [c] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Daybook Customer" }).returning();
    const base = { tenantId: org.tenantId, createdBy: org.userId, issueDate: DAY };
    await db.insert(issuedCheques).values([
      { ...base, bankAccountId: acct["1010"], chequeNumber: "900001", payeeKind: "supplier", payeeName: "Due Supplier", amount: "500", chequeDate: DAY },
      { ...base, bankAccountId: acct["1010"], chequeNumber: "900002", payeeKind: "supplier", payeeName: "Late Supplier", amount: "250", chequeDate: BEFORE },
      { ...base, bankAccountId: acct["1010"], chequeNumber: "900003", payeeKind: "supplier", payeeName: "Paid Supplier", amount: "75", chequeDate: BEFORE, status: "cleared", clearedDate: DAY },
    ]);
    await db.insert(receivedCheques).values({ tenantId: org.tenantId, createdBy: org.userId, customerId: c.id, payerName: c.name, drawerBank: "Test Bank", chequeNumber: "700001", amount: "300", receivedDate: BEFORE, chequeDate: DAY });

    const past = await loadDaybookPage(org.tenantId, DAY, "2026-12-01");
    const keys = past.cheques.groups.map((g) => g.key);
    expect(keys).toEqual(["due", "cleared"]);
    expect(past.cheques.groups[0]).toMatchObject({ issued: 500, received: 300 });
    expect(past.cheques.groups[1].rows.map((r) => r.number)).toEqual(["900003"]);

    const now = await loadDaybookPage(org.tenantId, DAY, DAY);
    expect(now.cheques.groups.find((g) => g.key === "overdue")?.rows.map((r) => r.number)).toEqual(["900002"]);
    expect((await loadDaybookPage(org.tenantId, "2026-11-06", "2026-12-01")).cheques.any).toBe(false);
  });

  it("a cash count is saved against the books of that day, replaced when counted again, and never changes the books", async () => {
    const before = await loadDaybook(org.tenantId, DAY);
    const first = await saveCashCount(org.tenantId, org.userId, { day: DAY, accountId: acct["1000"], notes: { "1000": 5, "500": 1 }, other: 200, remark: "evening" });
    expect(first).toEqual({ ok: true });
    let counts = await loadCashCounts(org.tenantId, DAY);
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ counted: 5700, book: 5750, remark: "evening", notes: { "1000": 5, "500": 1 } });

    await saveCashCount(org.tenantId, org.userId, { day: DAY, accountId: acct["1000"], notes: { "1000": 5, "500": 1, "50": 1 }, other: 200, remark: "" });
    counts = await loadCashCounts(org.tenantId, DAY);
    expect(counts).toHaveLength(1);
    expect(counts[0].counted).toBe(5750);
    expect(await loadDaybook(org.tenantId, DAY)).toEqual(before);
  });

  it("refuses a count of a bank account, a bad note count, and another day's data", async () => {
    expect(await saveCashCount(org.tenantId, org.userId, { day: DAY, accountId: acct["1010"], notes: {}, other: 0, remark: "" })).toMatchObject({ ok: false });
    expect(await saveCashCount(org.tenantId, org.userId, { day: DAY, accountId: acct["1000"], notes: { "1000": 1.5 }, other: 0, remark: "" })).toMatchObject({ ok: false });
    expect(await loadCashCounts(org.tenantId, "2026-11-05")).toEqual([]);
  });

  it("an invoice edited and reversed on the same day is not shown as money in and out", async () => {
    const id = randomUUID();
    const original = await post("2026-11-03", "sale", id, [{ accountId: acct["1100"], debitAmount: 400 }, { accountId: acct["4000"], creditAmount: 400 }]);
    await reverseJournalEntry(org.tenantId, original.id, org.userId, "Edit of invoice");
    await post("2026-11-03", "sale", id, [{ accountId: acct["1100"], debitAmount: 450 }, { accountId: acct["4000"], creditAmount: 450 }]);
    const d = await loadDaybook(org.tenantId, "2026-11-03");
    expect(d.sales.total).toBe(450);
    expect(d.sales.count).toBe(1);
    expect(d.reconciles).toBe(true);
  });
});
