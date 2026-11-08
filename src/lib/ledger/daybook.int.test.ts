import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listModeOptions, seedPaymentModes } from "@/lib/payment-modes";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { loadDaybook } from "./daybook";

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
