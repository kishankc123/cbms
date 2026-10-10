import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceExceptions, purchaseBills, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { exceptionDates } from "./exception-dates";
import { fiscalYearOfDate } from "./fiscal-year-of";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let vendorId: string;
const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const exception = (over: Partial<typeof complianceExceptions.$inferInsert>) =>
  db.insert(complianceExceptions).values({ tenantId: org.tenantId, exceptionType: "duplicate_invoice", description: "test", dedupeKey: "k" + Math.random(), ...over }).returning().then((r) => r[0]);
const bill = (n: string, date: string) =>
  db.insert(purchaseBills).values({ tenantId: org.tenantId, vendorId, billNumber: n, billDate: date, subtotal: "100", total: "100", status: "open" }).returning().then((r) => r[0]);

beforeAll(async () => {
  org = await createTempOrg("ZZ Exception Dates");
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Supplier" }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("which fiscal year an exception belongs to", () => {
  it("takes the date of the records behind it, the latest when there are several", async () => {
    const a = await bill("D-1", "2025-08-10"); // 2082/83
    const b = await bill("D-1", "2026-08-20"); // 2083/84
    const e = await exception({ transactionType: "purchase_bill", transactionId: `${a.id},${b.id}`, detectedDate: new Date("2026-10-01T00:00:00Z") });
    const dates = await exceptionDates(org.tenantId, [e]);
    expect(dates.get(e.id)).toBe("2026-08-20");
    expect(fiscalYearOfDate(dates.get(e.id)!).label).toBe("2083/84");
  });

  it("puts an exception about an old transaction in its own year, not the year the scan found it", async () => {
    const old = await bill("D-2", "2024-09-01"); // 2081/82
    const e = await exception({ transactionType: "purchase_bill", transactionId: old.id, detectedDate: new Date("2026-10-08T00:00:00Z") });
    const day = (await exceptionDates(org.tenantId, [e])).get(e.id)!;
    expect(day).toBe("2024-09-01");
    expect(fiscalYearOfDate(day).label).toBe("2081/82");
  });

  it("uses the entry date of a journal entry, and the day it was found for something with no date of its own", async () => {
    const cash = await acct("1000");
    const income = await acct("4100");
    const entry = await postJournalEntry({
      tenantId: org.tenantId,
      entryDate: "2025-01-15",
      sourceType: "manual",
      memo: "t",
      createdBy: org.userId,
      lines: [
        { accountId: cash.id, debitAmount: 10 },
        { accountId: income.id, creditAmount: 10 },
      ],
    });
    const j = await exception({ transactionType: "journal_entry", transactionId: entry.id, exceptionType: "backdated_transaction", detectedDate: new Date("2026-10-08T00:00:00Z") });
    const v = await exception({ transactionType: "vendor", transactionId: vendorId, exceptionType: "missing_pan", detectedDate: new Date("2026-10-08T00:00:00Z") });
    const dates = await exceptionDates(org.tenantId, [j, v]);
    expect(dates.get(j.id)).toBe("2025-01-15");
    expect(dates.get(v.id)).toBe("2026-10-08");
  });

  it("falls back to the day found when the record it names is gone", async () => {
    const e = await exception({ transactionType: "purchase_bill", transactionId: "00000000-0000-0000-0000-000000000000", detectedDate: new Date("2026-03-03T00:00:00Z") });
    expect((await exceptionDates(org.tenantId, [e])).get(e.id)).toBe("2026-03-03");
  });
});
