import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postSalesBatch } from "@/lib/sales/invoice-records";
import { listPaymentModes } from "@/lib/payment-modes";
import { generalLedger } from "./reports";
import { journalEntryDetail } from "./entry-detail";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Ledger Popup");
  other = await createTempOrg("ZZ Ledger Popup Other");
  cashId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("the transaction behind a ledger line", () => {
  it("the ledger carries each line's entry, and the entry shows every line it posted, debits first", async () => {
    const cashMode = (await listPaymentModes(org.tenantId)).find((m) => m.name === "Cash")!.id;
    await postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [{ invoiceDate: "2026-09-10", customerId: "", grossAmount: 1000, discountAmount: 0, billType: "zero_rated", payments: [{ accountId: cashId, amount: 1000, modeId: cashMode }] }]);

    const ledger = await generalLedger(org.tenantId, cashId, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-30T00:00:00Z"));
    expect(ledger.lines).toHaveLength(1);
    const detail = (await journalEntryDetail(org.tenantId, ledger.lines[0].entryId))!;
    expect(detail).toMatchObject({ entryDate: "2026-09-10", kind: "Payment received", isReversal: false, isReversed: false, totalDebit: 1000, totalCredit: 1000, link: { href: "/payments/money-in" } });
    expect(detail.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([["1000", 1000, 0], ["1100.01", 0, 1000]]);
    expect(detail.lines[0].mode).toBe("Cash"); // the mode the money came in by
  });

  it("never shows another organization's entry", async () => {
    const ledger = await generalLedger(org.tenantId, cashId, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-30T00:00:00Z"));
    expect(await journalEntryDetail(other.tenantId, ledger.lines[0].entryId)).toBeNull();
    expect(await journalEntryDetail(org.tenantId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
