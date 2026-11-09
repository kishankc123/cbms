import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "./post";
import { cashBankMovement, cashBook, generalLedger } from "./reports";

// The opening balance is entered as of the first day of the books. A report that starts on that day must show it on its "Opening balance" line, not
// as the first transaction of the period.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let acct: Record<string, string>;
const OPENING_DAY = "2026-07-17";
const d = (iso: string) => new Date(iso + "T00:00:00Z");

const post = (entryDate: string, sourceType: Parameters<typeof postJournalEntry>[0]["sourceType"], lines: Parameters<typeof postJournalEntry>[0]["lines"]) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate, sourceType, sourceId: randomUUID(), createdBy: org.userId, lines });

beforeAll(async () => {
  org = await createTempOrg("ZZ Opening Reports");
  const rows = await db.select().from(accounts).where(eq(accounts.tenantId, org.tenantId));
  acct = Object.fromEntries(rows.map((a) => [a.code, a.id]));
  await post(OPENING_DAY, "opening_balance", [{ accountId: acct["1000"], debitAmount: 5000 }, { accountId: acct["3000"], creditAmount: 5000 }]);
  await post("2026-07-20", "expense", [{ accountId: acct["5100"], debitAmount: 150 }, { accountId: acct["1000"], creditAmount: 150 }]);
});
afterAll(async () => {
  await org.remove();
});

describe("a report that starts on the opening balance date", () => {
  it("cash book: the opening balance is the opening line, and only the real transactions are listed", async () => {
    const r = await cashBook(org.tenantId, d(OPENING_DAY), d("2026-07-31"));
    expect(r.openingBalance).toBe(5000);
    expect(r.lines.map((l) => [l.debit, l.credit, l.runningBalance])).toEqual([[0, 150, 4850]]);
  });

  it("starting later gives the same opening line, and the closing balance is the same either way", async () => {
    const later = await cashBook(org.tenantId, d("2026-07-18"), d("2026-07-31"));
    expect(later.openingBalance).toBe(5000);
    expect(later.lines.at(-1)?.runningBalance).toBe(4850);
  });

  it("starting before the opening date keeps the opening entry as a line, because it happened inside the period", async () => {
    const r = await cashBook(org.tenantId, d("2026-07-01"), d("2026-07-31"));
    expect(r.openingBalance).toBe(0);
    expect(r.lines.map((l) => [l.debit, l.credit, l.runningBalance])).toEqual([[5000, 0, 5000], [0, 150, 4850]]);
  });

  it("the ledger and the bank book (same report) agree", async () => {
    const g = await generalLedger(org.tenantId, acct["1000"], d(OPENING_DAY), d("2026-07-31"));
    expect(g.openingBalance).toBe(5000);
    expect(g.lines.map((l) => l.runningBalance)).toEqual([4850]);
  });

  it("the cash and bank movement report counts the opening balance as the opening, not as money in", async () => {
    const m = await cashBankMovement(org.tenantId, d(OPENING_DAY), d("2026-07-31"));
    const cash = m.accounts.find((a) => a.code === "1000")!;
    expect(cash).toMatchObject({ openingBalance: 5000, totalIn: 0, totalOut: 150, closingBalance: 4850 });
    expect(m.bySourceType.some((s) => s.sourceType === "opening_balance")).toBe(false);
  });
});
