import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankReconciliationMatchJournalLines, bankReconciliationMatches, bankReconciliations, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { cashStatus, cashWorkspace, signOffCash } from "./cash-reconcile";
import { setReconcileMethod } from "./reconcile-method";

// A bank account can be reconciled by ticking its entries when its statement can't be uploaded. Entries already matched to a statement stay reconciled and
// join the opening figure; the bank's own balance is the proof instead of a cash count, and nothing is ever posted to cash short and excess for it.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let bankLedger: string;
let salesId: string;
let bankId: string;
let cashAccountId: string;
let matchedLine: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const post = (date: string, ref: string, amount: number) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "sale", referenceNumber: ref, createdBy: org.userId, lines: [{ accountId: bankLedger, debitAmount: amount }, { accountId: salesId, creditAmount: amount }] });
const lineOf = async (entryId: string) => (await db.select().from(journalLines).where(and(eq(journalLines.journalEntryId, entryId), eq(journalLines.accountId, bankLedger))))[0].id;

beforeAll(async () => {
  org = await createTempOrg("ZZ Reconcile Method");
  salesId = (await acct("4000")).id;
  bankLedger = (await db.insert(accounts).values({ tenantId: org.tenantId, code: "1010.01", name: "Test Bank", category: "asset", subCategory: "Current assets", parentAccountId: (await acct("1010")).id }).returning())[0].id;
  bankId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Test Bank", chartOfAccountsLink: bankLedger }).returning())[0].id;
  cashAccountId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Cash", chartOfAccountsLink: (await acct("1000")).id }).returning())[0].id;
  // 500 was matched to the statement before; two more entries (200, 300) are not.
  const first = await post("2026-10-02", "S-1", 500);
  matchedLine = await lineOf(first.id);
  await post("2026-10-05", "S-2", 200);
  await post("2026-10-06", "S-3", 300);
});
afterAll(async () => {
  await org.remove();
});

describe("a bank account that is reconciled by its statement", () => {
  it("can't use the ticking screen until it is switched", async () => {
    await expect(cashWorkspace(org.tenantId, bankId, "2026-10-31")).rejects.toThrow(/statement/);
  });

  it("is switched to ticking, and back, with the change recorded", async () => {
    expect((await setReconcileMethod(org.tenantId, org.userId, bankId, "statement")).changed).toBe(false);
    expect((await setReconcileMethod(org.tenantId, org.userId, bankId, "ticking")).changed).toBe(true);
    expect((await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankId)))[0].reconcileMethod).toBe("ticking");
    expect((await setReconcileMethod(org.tenantId, org.userId, bankId, "statement")).changed).toBe(true);
    await setReconcileMethod(org.tenantId, org.userId, bankId, "ticking");
  });

  it("is not switched while a statement reconciliation is half done", async () => {
    await setReconcileMethod(org.tenantId, org.userId, bankId, "statement");
    const [r] = await db.insert(bankReconciliations).values({ tenantId: org.tenantId, bankAccountId: bankId, periodStart: "2026-10-01", periodEnd: "2026-10-31", statementBalance: "0", ledgerBalance: "0", status: "in_progress" }).returning();
    await expect(setReconcileMethod(org.tenantId, org.userId, bankId, "ticking")).rejects.toThrow(/in progress/);
    await db.update(bankReconciliations).set({ status: "reconciled" }).where(eq(bankReconciliations.id, r.id));
    await setReconcileMethod(org.tenantId, org.userId, bankId, "ticking");
  });

  it("can't be changed for a cash account", async () => {
    await expect(setReconcileMethod(org.tenantId, org.userId, cashAccountId, "statement")).rejects.toThrow(/always reconciled by ticking/);
  });
});

describe("a bank account reconciled by ticking", () => {
  it("offers every entry, and takes ones matched to a statement into the opening figure", async () => {
    let ws = await cashWorkspace(org.tenantId, bankId, "2026-10-31");
    expect(ws.bank).toBe(true);
    expect(ws.lines.map((l) => l.reference)).toEqual(["S-1", "S-2", "S-3"]);
    expect(ws.opening).toBe(0);
    expect(ws.count).toBeNull();

    const [m] = await db.insert(bankReconciliationMatches).values({ tenantId: org.tenantId, bankAccountId: bankId, matchType: "manual", createdBy: org.userId }).returning();
    await db.insert(bankReconciliationMatchJournalLines).values({ matchId: m.id, journalLineId: matchedLine, amountApplied: "500" });
    ws = await cashWorkspace(org.tenantId, bankId, "2026-10-31");
    expect(ws.lines.map((l) => l.reference)).toEqual(["S-2", "S-3"]);
    expect(ws.opening).toBe(500);
    expect((await cashStatus(org.tenantId, bankId)).unreconciled).toBe(2);
  });

  it("is reconciled with the bank's balance as proof, and a difference is never posted", async () => {
    const ws = await cashWorkspace(org.tenantId, bankId, "2026-10-31");
    const ids = ws.lines.map((l) => l.id);
    // Books say 500 + 200 + 300 = 1000; the bank shows 950.
    await expect(signOffCash(org.tenantId, org.userId, { bankAccountId: bankId, asOf: "2026-10-31", lineIds: ids, useCount: false, adjust: true, bankBalance: 950, note: "" })).resolves.toMatchObject({ closing: 1000, adjustment: 0 });
    const next = await cashWorkspace(org.tenantId, bankId, "2026-10-31");
    expect(next.lines).toEqual([]);
    expect(next.last).toMatchObject({ closing: 1000, kind: "counted" });
    expect(next.opening).toBe(1000);
  });
});
