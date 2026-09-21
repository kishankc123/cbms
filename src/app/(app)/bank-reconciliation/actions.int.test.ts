import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankReconciliations, bankStatementLines, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry } from "@/lib/ledger/post";
import { assertSourceNotReconciled } from "@/lib/ledger/reconciliation-guards";
import { assertNoLaterPayments } from "@/lib/ledger/account-guards";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const A = await import("./actions");

const acct = async (tenantId: string, code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code))))[0];
let bankId: string;
let bankLedgerId: string;
let salesId: string;

const csv = (rows: string[]) => Buffer.from(["Date,Description,Amount", ...rows].join("\n")).toString("base64");
const importRows = (rows: string[]) =>
  A.confirmStatementImport({ bankAccountId: bankId, fileName: "stmt.csv", base64: csv(rows), mapping: { date: "Date", description: "Description", amount: "Amount" }, saveAsTemplateName: "", dateChoice: "AD" });
const stmtLines = () => db.select().from(bankStatementLines).where(eq(bankStatementLines.bankAccountId, bankId));
const dr = async (date: string, amount: number, sourceId?: string) => {
  const entry = await postJournalEntry({
    tenantId: org.tenantId,
    entryDate: date,
    sourceType: "manual",
    sourceId,
    createdBy: org.userId,
    lines: amount > 0 ? [{ accountId: bankLedgerId, debitAmount: amount }, { accountId: salesId, creditAmount: amount }] : [{ accountId: salesId, debitAmount: -amount }, { accountId: bankLedgerId, creditAmount: -amount }],
  });
  return (await db.select().from(journalLines).where(and(eq(journalLines.journalEntryId, entry.id), eq(journalLines.accountId, bankLedgerId))))[0];
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Bank Rec Test");
  other = await createTempOrg("ZZ Bank Rec Other");
  salesId = (await acct(org.tenantId, "4000")).id;
  const bankGroup = await acct(org.tenantId, "1010");
  bankLedgerId = (await createSubAccount(org.tenantId, bankGroup, "Test Bank")).id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("bank account setup", () => {
  it("only links this organization's Cash/Bank accounts, once, at the lowest level", async () => {
    const base = { bankName: "B", accountName: "Main", accountNumber: "", branch: "", currency: "NPR", openingBalance: 0 };
    await expect(A.createBankAccount({ ...base, chartOfAccountsLink: salesId })).rejects.toThrow(/Cash or Bank/);
    await expect(A.createBankAccount({ ...base, chartOfAccountsLink: (await acct(other.tenantId, "1010")).id })).rejects.toThrow(/Chart of Accounts/);
    await expect(A.createBankAccount({ ...base, chartOfAccountsLink: (await acct(org.tenantId, "1010")).id })).rejects.toThrow(/sub-accounts/);

    await A.createBankAccount({ ...base, chartOfAccountsLink: bankLedgerId, openingBalance: 5000 });
    const [b] = await db.select().from(bankAccounts).where(eq(bankAccounts.tenantId, org.tenantId));
    bankId = b.id;
    await expect(A.createBankAccount({ ...base, accountName: "Again", chartOfAccountsLink: bankLedgerId })).rejects.toThrow(/already linked/);
  });

  it("posts the opening balance to the ledger, and re-posts it when it changes", async () => {
    const balance = async () => {
      const lines = await db
        .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
        .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, bankLedgerId)));
      return lines.reduce((s, r) => s + Number(r.d) - Number(r.c), 0);
    };
    expect(await balance()).toBe(5000);
    await A.updateBankAccount({ bankAccountId: bankId, bankName: "B", accountName: "Main", accountNumber: "", branch: "", currency: "NPR", chartOfAccountsLink: bankLedgerId, openingBalance: 6000 });
    expect(await balance()).toBe(6000);
  });

  it("won't switch off an account that still holds money", async () => {
    await expect(A.setBankAccountActive({ bankAccountId: bankId, isActive: false })).rejects.toThrow(/still holds/);
  });
});

describe("statement import", () => {
  it("keeps genuine repeat transactions, and refuses a file it has already taken", async () => {
    const rows = ["2026-09-01,Deposit,100", "2026-09-01,Deposit,100", "2026-09-02,Fee,-10"];
    expect((await importRows(rows)).imported).toBe(3);
    expect((await stmtLines()).length).toBe(3);
    await expect(importRows(rows)).rejects.toThrow(/already been imported/);
  });
  it("refuses a bank account from another organization", async () => {
    await expect(A.confirmStatementImport({ bankAccountId: crypto.randomUUID(), fileName: "s.csv", base64: csv(["2026-09-03,X,5"]), mapping: { date: "Date", description: "Description", amount: "Amount" }, saveAsTemplateName: "", dateChoice: "AD" })).rejects.toThrow(/Bank account not found/);
  });
});

describe("matching", () => {
  it("checks the lines before matching, and never matches a line twice", async () => {
    // the opening balance also sits on the bank ledger, dated at the start of the fiscal year
    const l1 = await dr("2026-09-01", 100, crypto.randomUUID());
    const l2 = await dr("2026-09-01", 100, crypto.randomUUID());
    const fee = await dr("2026-09-02", -10);
    const [s1, s2, sFee] = (await stmtLines()).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || Number(b.amount) - Number(a.amount));

    await expect(A.confirmMatch({ bankAccountId: bankId, statementLineIds: [s1.id], journalLineIds: [fee.id], matchType: "manual" })).rejects.toThrow(/don't agree/);

    // a ledger line from another organization is refused
    const foreignBank = await acct(other.tenantId, "1000");
    const foreignSales = await acct(other.tenantId, "4000");
    const foreignEntry = await postJournalEntry({ tenantId: other.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: other.userId, lines: [{ accountId: foreignBank.id, debitAmount: 100 }, { accountId: foreignSales.id, creditAmount: 100 }] });
    const [foreignLine] = await db.select().from(journalLines).where(and(eq(journalLines.journalEntryId, foreignEntry.id), eq(journalLines.accountId, foreignBank.id)));
    await expect(A.confirmMatch({ bankAccountId: bankId, statementLineIds: [s1.id], journalLineIds: [foreignLine.id], matchType: "manual" })).rejects.toThrow(/aren't postings to this bank account/);

    await A.confirmMatch({ bankAccountId: bankId, statementLineIds: [s1.id], journalLineIds: [l1.id], matchType: "manual" });
    // the same ledger line can't back a second statement line, nor a matched statement line a second ledger line
    await expect(A.confirmMatch({ bankAccountId: bankId, statementLineIds: [s2.id], journalLineIds: [l1.id], matchType: "manual" })).rejects.toThrow(/already matched/);
    await expect(A.confirmMatch({ bankAccountId: bankId, statementLineIds: [s1.id], journalLineIds: [l2.id], matchType: "manual" })).rejects.toThrow(/already matched/);

    await A.confirmMatch({ bankAccountId: bankId, statementLineIds: [s2.id], journalLineIds: [l2.id], matchType: "manual" });
    await A.confirmMatch({ bankAccountId: bankId, statementLineIds: [sFee.id], journalLineIds: [fee.id], matchType: "manual" });
  });

  it("can't create a transaction against the bank account itself", async () => {
    await importRows(["2026-09-04,Interest,7"]);
    const line = (await stmtLines()).find((l) => l.description === "Interest")!;
    await expect(A.createBankTransaction({ statementLineId: line.id, bankAccountId: bankId, type: "other", description: "Interest", offsetAccountId: bankLedgerId })).rejects.toThrow(/bank account itself/);
    const before = (await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length;
    await A.createBankTransaction({ statementLineId: line.id, bankAccountId: bankId, type: "other", description: "Interest", offsetAccountId: salesId });
    expect((await db.select().from(journalEntries).where(eq(journalEntries.tenantId, org.tenantId))).length).toBe(before + 1);
    expect((await stmtLines()).find((l) => l.id === line.id)!.matchStatus).toBe("matched");
  });
});

describe("marking a period reconciled", () => {
  it("is refused while something is unmatched or unexplained, then works and closes the period", async () => {
    // an unmatched ledger line and an unmatched bank line
    await dr("2026-09-05", 40);
    await importRows(["2026-09-05,Unmatched,25"]);
    const blocked = await A.previewReconciliation({ bankAccountId: bankId, periodEnd: "2026-09-10" });
    expect(blocked.blockers.join(" ")).toMatch(/bank statement line/);
    expect(blocked.blockers.join(" ")).toMatch(/explained/);
    await expect(A.markReconciled({ bankAccountId: bankId, periodEnd: "2026-09-10" })).rejects.toThrow(/aren't matched/);
  });

  it("closes the period to posting, editing and overlapping periods once the balances agree", async () => {
    // a second bank account with nothing else on it is the simplest way to see a period close
    const bank2Ledger = (await createSubAccount(org.tenantId, await acct(org.tenantId, "1010"), "Second Bank")).id;
    await A.createBankAccount({ bankName: "B2", accountName: "Second", accountNumber: "", branch: "", currency: "NPR", chartOfAccountsLink: bank2Ledger, openingBalance: 0 });
    const [b2] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.tenantId, org.tenantId), eq(bankAccounts.chartOfAccountsLink, bank2Ledger)));
    await A.confirmStatementImport({ bankAccountId: b2.id, fileName: "s.csv", base64: csv(["2026-08-01,In,500"]), mapping: { date: "Date", description: "Description", amount: "Amount" }, saveAsTemplateName: "", dateChoice: "AD" });
    const entry = await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-01", sourceType: "manual", sourceId: "00000000-0000-0000-0000-0000000000aa", createdBy: org.userId, lines: [{ accountId: bank2Ledger, debitAmount: 500 }, { accountId: salesId, creditAmount: 500 }] });
    const [jl] = await db.select().from(journalLines).where(and(eq(journalLines.journalEntryId, entry.id), eq(journalLines.accountId, bank2Ledger)));
    const [sl] = await db.select().from(bankStatementLines).where(eq(bankStatementLines.bankAccountId, b2.id));
    await A.confirmMatch({ bankAccountId: b2.id, statementLineIds: [sl.id], journalLineIds: [jl.id], matchType: "manual" });

    await expect(A.markReconciled({ bankAccountId: b2.id, periodEnd: "2099-01-01" })).rejects.toThrow(/future/);
    await A.markReconciled({ bankAccountId: b2.id, periodEnd: "2026-08-31" });
    const [rec] = await db.select().from(bankReconciliations).where(eq(bankReconciliations.bankAccountId, b2.id));
    expect(rec.status).toBe("reconciled");
    expect(Number(rec.statementBalance)).toBe(500);
    expect(Number(rec.ledgerBalance)).toBe(500);

    // periods never overlap
    await expect(A.markReconciled({ bankAccountId: b2.id, periodEnd: "2026-08-15" })).rejects.toThrow(/already reconciled/);
    // nothing can be posted into the reconciled period
    await expect(postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-08-10", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: bank2Ledger, debitAmount: 5 }, { accountId: salesId, creditAmount: 5 }] })).rejects.toThrow(/reconciled for/);
    // a document with a matched bank line can't be edited or voided underneath the match
    await expect(assertSourceNotReconciled(org.tenantId, "00000000-0000-0000-0000-0000000000aa", "invoice")).rejects.toThrow(/unmatch it/);
    await expect(assertNoLaterPayments(org.tenantId, "sales_invoice", "00000000-0000-0000-0000-0000000000aa", "invoice")).rejects.toThrow(/unmatch it/);
    // and a new statement can't add transactions inside it
    await expect(A.confirmStatementImport({ bankAccountId: b2.id, fileName: "s.csv", base64: csv(["2026-08-20,Late,9"]), mapping: { date: "Date", description: "Description", amount: "Amount" }, saveAsTemplateName: "", dateChoice: "AD" })).rejects.toThrow(/already reconciled/);
  });
});
