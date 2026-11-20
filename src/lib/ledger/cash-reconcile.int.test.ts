import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { getOrCreateBroughtForwardAccount } from "@/lib/ledger/control-accounts";
import { saveCashCount } from "@/lib/ledger/cash-count";
import { cashHistory, cashStatus, cashWorkspace, explainExcess, reconEntries, explainWithExpense, getCashLock, incomeAccountOptions, reopenCashBackTo, signOffCash, unexplainedTotal } from "./cash-reconcile";
import { findShortExcessAccount } from "./cash-short-excess";
import { reconciledEntryIds } from "./reconciled-entries";
import type { ExpenseInput } from "@/lib/expenses/expense-records";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let salesId: string;
let miscId: string;
let incomeId: string;
let bankAccountId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const firstSale = randomUUID();
const receipt = (date: string, ref: string, amount: number, sourceId?: string) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "sale", sourceId, referenceNumber: ref, createdBy: org.userId, lines: [{ accountId: cashId, debitAmount: amount }, { accountId: salesId, creditAmount: amount }] });
const spend = (date: string, ref: string, amount: number) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "expense", referenceNumber: ref, createdBy: org.userId, lines: [{ accountId: miscId, debitAmount: amount }, { accountId: cashId, creditAmount: amount }] });
const balanceOf = async (accountId: string) => {
  const [r] = await db
    .select({ net: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, accountId)));
  return Number(r.net);
};
const expense = (amount: number): ExpenseInput => ({ expenseDate: "2026-10-12", categoryAccountId: miscId, vendorId: null, description: "Courier charge", invoiceNumber: "", invoiceDate: "", dueDate: "", billType: "no_bill", taxTreatment: "taxable", taxableAmount: amount, vatAmount: 0, tdsAmount: 0, otherTaxAmount: 0, payments: [] });

beforeAll(async () => {
  org = await createTempOrg("ZZ Cash Recon");
  other = await createTempOrg("ZZ Cash Recon Other");
  cashId = (await acct("1000")).id;
  salesId = (await acct("4000")).id;
  miscId = (await acct("5900")).id;
  incomeId = (await acct("4100")).id;
  [{ id: bankAccountId }] = await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash in hand", chartOfAccountsLink: cashId }).returning({ id: bankAccounts.id });
  // Opening 100, five receipts of 200 and two payments of 100: the books say 900.
  const bf = await getOrCreateBroughtForwardAccount(org.tenantId);
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-10-01", sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: cashId, debitAmount: 100 }, { accountId: bf.id, creditAmount: 100 }] });
  for (let i = 1; i <= 5; i++) await receipt("2026-10-0" + (i + 1), `S-${i}`, 200, i === 1 ? firstSale : undefined);
  await spend("2026-10-08", "E-1", 100);
  await spend("2026-10-09", "E-2", 100);
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

let firstId: string;
let shortId: string;
let excessId: string;

describe("reconciling a cash account", () => {
  it("shows the entries still to reconcile, with the opening balance taken into the opening", async () => {
    const w = await cashWorkspace(org.tenantId, bankAccountId, "2026-10-10");
    expect(w.opening).toBe(100);
    expect(w.lines).toHaveLength(7);
    expect(w.last).toBeNull();
    expect(w.count).toBeNull();
    expect((await cashStatus(org.tenantId, bankAccountId)).unreconciled).toBe(7);
  });

  it("refuses to reconcile with nothing ticked, and a bank account", async () => {
    await expect(signOffCash(org.tenantId, org.userId, { bankAccountId, asOf: "2026-10-10", lineIds: [], useCount: false, adjust: false, note: "" })).rejects.toThrow(/Tick the entries/);
    await expect(cashWorkspace(other.tenantId, bankAccountId, "2026-10-10")).rejects.toThrow(/not found/);
  });

  it("confirms the closing balance without a count", async () => {
    const w = await cashWorkspace(org.tenantId, bankAccountId, "2026-10-10");
    const r = await signOffCash(org.tenantId, org.userId, { bankAccountId, asOf: "2026-10-10", lineIds: w.lines.map((l) => l.id), useCount: false, adjust: false, note: "" });
    firstId = r.id;
    expect(r).toMatchObject({ closing: 900, adjustment: 0 });
    const h = await cashHistory(org.tenantId, bankAccountId);
    expect(h[0]).toMatchObject({ opening: 100, closing: 900, kind: "confirmed", counted: null });
    expect((await cashStatus(org.tenantId, bankAccountId)).unreconciled).toBe(0);
    // "Up to" is the latest entry it took in (9 Oct), not the cut-off that was picked (10 Oct).
    expect(h[0]).toMatchObject({ asOf: "2026-10-10", through: "2026-10-09", entries: 7 });
    expect((await cashStatus(org.tenantId, bankAccountId)).through).toBe("2026-10-09");
    expect((await reconEntries(org.tenantId, firstId)).map((e) => e.reference)).toEqual(expect.arrayContaining(["S-1", "E-2"]));
    // The Reconciliation column of Payments counts a cash reconciliation, not only a bank match.
    const entry = (await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.referenceNumber, "S-1"))))[0];
    expect((await reconciledEntryIds(org.tenantId, [entry.id])).has(entry.id)).toBe(true);
    expect((await reconciledEntryIds(other.tenantId, [entry.id])).has(entry.id)).toBe(false);
  });

  it("opens the next one at the last closing, and a count that is short is adjusted into the one short and excess account", async () => {
    await receipt("2026-10-11", "S-6", 100);
    await receipt("2026-10-11", "S-7", 100);
    await saveCashCount(org.tenantId, org.userId, { day: "2026-10-11", accountId: cashId, notes: {}, other: 1050, remark: "" });
    const w = await cashWorkspace(org.tenantId, bankAccountId, "2026-10-11");
    expect(w.opening).toBe(900);
    expect(w.lines).toHaveLength(2);
    expect(w.count?.total).toBe(1050);
    // Books say 1,100; counted 1,050: 50 short.
    // Reconciling nothing, with no count, is refused whatever the cut-off date.
    await expect(signOffCash(org.tenantId, org.userId, { bankAccountId, asOf: "2026-10-09", lineIds: [], useCount: false, adjust: false, note: "" })).rejects.toThrow(/Tick the entries/);
    const r = await signOffCash(org.tenantId, org.userId, { bankAccountId, asOf: "2026-10-11", lineIds: w.lines.map((l) => l.id), useCount: true, adjust: true, note: "Counted by Sita" });
    shortId = r.id;
    expect(r).toMatchObject({ closing: 1050, adjustment: -50 });
    expect(await balanceOf(cashId)).toBe(1050);
    const se = await findShortExcessAccount(org.tenantId);
    expect(se?.code).toBe("5930");
    expect(await balanceOf(se!.id)).toBe(50);
    expect((await cashStatus(org.tenantId, bankAccountId)).unreconciled).toBe(0);
    expect(await unexplainedTotal(org.tenantId)).toBe(50);
  });

  it("explains the shortage later with an expense settled from the short and excess account, leaving the cash alone", async () => {
    await expect(explainWithExpense({ tenantId: org.tenantId, userId: org.userId }, shortId, expense(80), 80)).rejects.toThrow(/still unexplained/);
    const r = await explainWithExpense({ tenantId: org.tenantId, userId: org.userId }, shortId, expense(50), 50);
    expect(r.expenseNumber).toMatch(/^EXP-/);
    const se = await findShortExcessAccount(org.tenantId);
    expect(await balanceOf(se!.id)).toBe(0);
    expect(await balanceOf(cashId)).toBe(1050);
    const h = await cashHistory(org.tenantId, bankAccountId);
    expect(h[0]).toMatchObject({ adjustment: -50, explained: 50, remaining: 0, state: "explained" });
    expect(await unexplainedTotal(org.tenantId)).toBe(0);
    await expect(explainWithExpense({ tenantId: org.tenantId, userId: org.userId }, shortId, expense(10), 10)).rejects.toThrow(/still unexplained/);
  });

  it("posts an excess to the same account and moves it to income once the receipt is found", async () => {
    await saveCashCount(org.tenantId, org.userId, { day: "2026-10-12", accountId: cashId, notes: {}, other: 1075, remark: "" });
    const w = await cashWorkspace(org.tenantId, bankAccountId, "2026-10-12");
    expect(w.lines).toHaveLength(0);
    const r = await signOffCash(org.tenantId, org.userId, { bankAccountId, asOf: "2026-10-12", lineIds: [], useCount: true, adjust: true, note: "" });
    excessId = r.id;
    expect(r).toMatchObject({ closing: 1075, adjustment: 25 });
    const se = await findShortExcessAccount(org.tenantId);
    expect(await balanceOf(se!.id)).toBe(-25);
    expect((await incomeAccountOptions(org.tenantId)).some((o) => o.id === incomeId)).toBe(true);
    await expect(explainExcess({ tenantId: org.tenantId, userId: org.userId }, excessId, { accountId: miscId, amount: 25, date: "2026-10-13", note: "" })).rejects.toThrow(/income account/);
    await explainExcess({ tenantId: org.tenantId, userId: org.userId }, excessId, { accountId: incomeId, amount: 25, date: "2026-10-12", note: "Old customer paid" });
    expect(await balanceOf(se!.id)).toBe(0);
    expect(await balanceOf(cashId)).toBe(1075);
  });

  it("locks a ticked entry: it can't be reversed, and nothing is posted to an earlier day of a reconciled account", async () => {
    const lock = await getCashLock(org.tenantId, firstSale);
    expect(lock).toMatchObject({ asOf: "2026-10-09", accountName: "Cash" });
    expect(lock?.reopens).toEqual(["2026-10-12", "2026-10-11", "2026-10-09"]);
    const [entry] = await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, firstSale)));
    await expect(reverseJournalEntry(org.tenantId, entry.id, org.userId)).rejects.toThrow(/locked/);
    await expect(receipt("2026-10-11", "LATE-1", 10)).rejects.toThrow(/reconciled up to 2026-10-12/);
    // The reconciled day itself stays open: a sale entered after the count is accepted and waits for the next reconciliation.
    await receipt("2026-10-12", "LATE-2", 10);
    const w = await cashWorkspace(org.tenantId, bankAccountId, "2026-10-12");
    expect(w.lines.map((l) => l.reference)).toEqual(["LATE-2"]);
  });

  it("unlocks by reopening the reconciliation and every later one, remembering what was ticked", async () => {
    const r = await reopenCashBackTo(org.tenantId, org.userId, firstId, "Wrong amount on the first sale");
    expect(r.reopened).toBe(3);
    const h = await cashHistory(org.tenantId, bankAccountId);
    expect(h.map((x) => x.status)).toEqual(["reopened", "reopened", "reopened"]);
    const w = await cashWorkspace(org.tenantId, bankAccountId, "2026-10-12");
    expect(w.last).toBeNull();
    expect(w.opening).toBe(100);
    // Everything is open again, and what had been ticked is offered back (the adjustments are entries now too).
    expect(w.lines).toHaveLength(12);
    expect(w.remembered).toHaveLength(11);
    expect(w.remembered).not.toContain(w.lines.find((l) => l.reference === "LATE-2")!.id);
    const [entry] = await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, firstSale)));
    await reverseJournalEntry(org.tenantId, entry.id, org.userId, "Corrected");
    expect(await getCashLock(org.tenantId, firstSale)).toBeNull();
    await expect(reopenCashBackTo(org.tenantId, org.userId, firstId, "again")).rejects.toThrow(/not found/);
  });

  it("can still explain a short whose reconciliation was reopened, until its entry is voided", async () => {
    const h = await cashHistory(org.tenantId, bankAccountId);
    const short = h.find((x) => x.id === shortId)!;
    expect(short).toMatchObject({ adjustment: -50, state: "explained", status: "reopened" });
  });
});
