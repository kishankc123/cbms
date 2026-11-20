import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceCategories, complianceObligations, items, journalEntries, journalLines, purchaseBills, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";

// Once a VAT return is filed, what it counts is locked; item details can still be added to a purchase recorded by amount, but only as shares of the filed figures.
let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { recordPendingPurchases, updatePurchaseInvoice, voidBill } = await import("./actions");

vi.setConfig({ testTimeout: 300_000 });

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  if (!a) return 0;
  const rows = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(rows.reduce((s, r) => s + Number(r.d) - Number(r.c), 0) * 100) / 100 + 0;
}
const billOf = async (n: string) => (await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, org.tenantId), eq(purchaseBills.billNumber, n))))[0];
const fd = (id: string) => Object.assign(new FormData(), { get: () => id }) as unknown as FormData;
const row = (over: Record<string, unknown> = {}) => ({ billDate: "2026-10-05", vendorId, billNumber: "", billType: "vat" as const, categoryId: "", description: "", amount: 1000, discount: 0, payments: [] as { accountId: string; amount: number }[], ...over });

let vendorId: string;
let widget: string;
let obligationId: string;
let cashId: string;
let salesId: string;
let miscId: string;

const sale = (date: string, ref: string, amount = 100) => postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "sale", referenceNumber: ref, createdBy: org.userId, lines: [{ accountId: cashId, debitAmount: amount }, { accountId: salesId, creditAmount: amount }] });

beforeAll(async () => {
  org = await createTempOrg("ZZ VAT lock");
  await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Himal Traders" }).returning())[0].id;
  widget = (await db.insert(items).values({ tenantId: org.tenantId, name: "Widget", inventoryTracking: true }).returning())[0].id;
  cashId = (await acct("1000")).id;
  salesId = (await acct("4000")).id;
  miscId = (await acct("5900")).id;
});
afterAll(async () => {
  await org.remove();
});

const fileOctober = async () => {
  const [cat] = await db.select({ key: complianceCategories.key }).from(complianceCategories).limit(1);
  const [o] = await db
    .insert(complianceObligations)
    .values({ tenantId: org.tenantId, name: "VAT return", categoryKey: cat.key, taxTypeKey: "vat", periodLabel: "Kartik 2083", periodStart: "2026-10-01", periodEnd: "2026-10-31", dueDate: "2026-11-25", status: "filed" })
    .returning();
  obligationId = o.id;
};

describe("a filed VAT return locks what it counts", () => {
  let oldSale: string;
  let pendingA: string;
  let pendingB: string;
  let pendingC: string;

  it("sets up bills recorded by amount and a sale, then files the return", async () => {
    oldSale = (await sale("2026-10-03", "S-OLD")).id;
    await recordPendingPurchases({ rows: [row({ billNumber: "P-A" }), row({ billNumber: "P-B" }), row({ billNumber: "P-C" })] });
    pendingA = (await billOf("P-A")).id;
    pendingB = (await billOf("P-B")).id;
    pendingC = (await billOf("P-C")).id;
    expect(await balance("1300")).toBe(390); // 3 x 130 VAT
    await fileOctober();
  });

  it("refuses to record, change or void anything the return counts", async () => {
    await expect(sale("2026-10-20", "S-LATE")).rejects.toThrow(/VAT return for Kartik 2083 has been filed/);
    await expect(reverseJournalEntry(org.tenantId, oldSale, org.userId)).rejects.toThrow(/has been filed/);
    await expect(voidBill(fd(pendingA))).rejects.toThrow(/has been filed/);
    expect(await recordPendingPurchases({ rows: [row({ billNumber: "P-LATE", billDate: "2026-10-12" })] })).toMatchObject({ ok: false, saved: 0, error: expect.stringMatching(/has been filed/) });
  });

  it("leaves other periods, other kinds of entry and an expense without VAT alone", async () => {
    await sale("2026-11-02", "S-NOV");
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-10-10", sourceType: "payment", createdBy: org.userId, lines: [{ accountId: miscId, debitAmount: 5 }, { accountId: cashId, creditAmount: 5 }] });
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-10-10", sourceType: "expense", createdBy: org.userId, lines: [{ accountId: miscId, debitAmount: 5 }, { accountId: cashId, creditAmount: 5 }] });
    const taxReceivable = await acct("1300");
    await expect(
      postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-10-10", sourceType: "expense", createdBy: org.userId, lines: [{ accountId: miscId, debitAmount: 100 }, { accountId: taxReceivable.id, debitAmount: 13 }, { accountId: cashId, creditAmount: 113 }] })
    ).rejects.toThrow(/has been filed/);
  });

  it("adds the items to a bill whose return is filed when they match it, and keeps the VAT exactly as filed when they are a little off", async () => {
    const lines = (rate: number, quantity: number) => [{ itemId: widget, description: "", rate, quantity, discount: 0 }];
    const base = { invoiceNumber: "", invoiceDate: "2026-10-05", vendorId, billType: "vat" as const, payments: [] };
    // exactly 1,000: posted as entered
    await updatePurchaseInvoice({ ...base, billId: pendingA, invoiceNumber: "P-A", lines: lines(100, 10) });
    expect(await billOf("P-A")).toMatchObject({ detailsPending: false, subtotal: "1000.00", taxAmount: "130.00", total: "1130.00" });
    // 1,000.40: within the rounding allowance, so the filed 1,000 and 130 stand
    await updatePurchaseInvoice({ ...base, billId: pendingB, invoiceNumber: "P-B", lines: lines(500.2, 2) });
    expect(await billOf("P-B")).toMatchObject({ detailsPending: false, subtotal: "1000.00", taxAmount: "130.00", total: "1130.00" });
    expect(await balance("1300")).toBe(390);
    expect(await balance("1200")).toBe(2000);
  });

  it("refuses items that are further off than the allowance, and a changed date or bill type", async () => {
    const base = { invoiceNumber: "P-C", invoiceDate: "2026-10-05", vendorId, billType: "vat" as const, payments: [], billId: pendingC };
    await expect(updatePurchaseInvoice({ ...base, lines: [{ itemId: widget, description: "", rate: 150, quantity: 10, discount: 0 }] })).rejects.toThrow(/500.00 more than the bill's value of 1000.00.*filed/);
    await expect(updatePurchaseInvoice({ ...base, lines: [{ itemId: widget, description: "", rate: 100, quantity: 10, discount: 0 }], billType: "pan" })).rejects.toThrow(/date and bill type can't change/);
    expect((await billOf("P-C")).detailsPending).toBe(true);
  });

  it("opens again when the filing is reopened", async () => {
    await db.update(complianceObligations).set({ status: "in_progress" }).where(eq(complianceObligations.id, obligationId));
    await sale("2026-10-21", "S-AFTER-REOPEN");
    await voidBill(fd(pendingC));
    expect((await billOf("P-C")).status).toBe("void");
  });

  it("does not lock a period that was filed before the organization started using the system", async () => {
    await db.update(complianceObligations).set({ status: "filed", filedBeforeSystem: true }).where(eq(complianceObligations.id, obligationId));
    await sale("2026-10-22", "S-HISTORY");
  });
});
