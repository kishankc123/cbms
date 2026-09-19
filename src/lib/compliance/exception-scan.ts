import crypto from "crypto";
import { and, eq, ne, sql, asc, or } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  purchaseBills,
  vendors,
  complianceExceptions,
  complianceRules,
  bankStatementLines,
  bankAccounts,
  journalEntries,
  journalLines,
} from "@/db/schema";

function dedupeKey(type: string, ...parts: string[]) {
  return crypto.createHash("sha256").update([type, ...parts].join("|")).digest("hex");
}

async function alreadyOpenKeys(tenantId: string): Promise<Set<string>> {
  const rows = await db
    .select({ dedupeKey: complianceExceptions.dedupeKey })
    .from(complianceExceptions)
    .where(and(eq(complianceExceptions.tenantId, tenantId), ne(complianceExceptions.status, "closed")));
  return new Set(rows.map((r) => r.dedupeKey));
}

type NewException = {
  tenantId: string;
  transactionType: string;
  transactionId: string;
  exceptionType: (typeof complianceExceptions.$inferInsert)["exceptionType"];
  severity: (typeof complianceExceptions.$inferInsert)["severity"];
  description: string;
  dedupeKey: string;
};

// Duplicate invoice numbers for the same vendor across Purchases and
// Expenses (excluding void records) — reliably derivable from data already
// captured, no rule configuration needed.
async function detectDuplicateInvoices(tenantId: string, seen: Set<string>): Promise<NewException[]> {
  const found: NewException[] = [];

  const billRows = await db
    .select({ vendorId: purchaseBills.vendorId, billNumber: purchaseBills.billNumber, id: purchaseBills.id })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, tenantId), ne(purchaseBills.status, "void")));
  const expenseRows = await db
    .select({ vendorId: expenses.vendorId, invoiceNumber: expenses.invoiceNumber, id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void")));

  const byKey = new Map<string, { type: string; id: string }[]>();
  for (const b of billRows) {
    if (!b.vendorId || !b.billNumber) continue;
    const key = `${b.vendorId}::${b.billNumber.trim().toLowerCase()}`;
    const list = byKey.get(key) ?? [];
    list.push({ type: "purchase_bill", id: b.id });
    byKey.set(key, list);
  }
  for (const e of expenseRows) {
    if (!e.vendorId || !e.invoiceNumber) continue;
    const key = `${e.vendorId}::${e.invoiceNumber.trim().toLowerCase()}`;
    const list = byKey.get(key) ?? [];
    list.push({ type: "expense", id: e.id });
    byKey.set(key, list);
  }

  for (const [key, entries] of byKey) {
    if (entries.length < 2) continue;
    const dk = dedupeKey("duplicate_invoice", key);
    if (seen.has(dk)) continue;
    found.push({
      tenantId,
      transactionType: entries[0].type,
      transactionId: entries.map((e) => e.id).join(","),
      exceptionType: "duplicate_invoice",
      severity: "review_required",
      description: `${entries.length} transactions share the same supplier + invoice number`,
      dedupeKey: dk,
    });
  }
  return found;
}

// Bank statement lines still unmatched past the age configured in an active
// "bank_unreconciled_days" rule — skipped entirely if no such rule exists,
// so nothing here is a hard-coded threshold.
async function detectUnreconciledBankLines(tenantId: string, seen: Set<string>): Promise<NewException[]> {
  const [rule] = await db
    .select()
    .from(complianceRules)
    .where(
      and(
        eq(complianceRules.tenantId, tenantId),
        eq(complianceRules.checkType, "bank_unreconciled_days"),
        eq(complianceRules.isActive, true)
      )
    )
    .limit(1);
  if (!rule || !rule.thresholdValue) return [];

  const thresholdDays = Number(rule.thresholdValue);
  const today = new Date();
  const found: NewException[] = [];

  const lines = await db
    .select({ id: bankStatementLines.id, transactionDate: bankStatementLines.transactionDate, description: bankStatementLines.description, bankAccountId: bankStatementLines.bankAccountId })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, tenantId), or(eq(bankStatementLines.matchStatus, "unmatched"), eq(bankStatementLines.matchStatus, "suggested"))));

  for (const l of lines) {
    const days = Math.floor((today.getTime() - new Date(l.transactionDate + "T00:00:00Z").getTime()) / 86400000);
    if (days < thresholdDays) continue;
    const dk = dedupeKey("unreconciled_bank_transaction", l.id);
    if (seen.has(dk)) continue;
    found.push({
      tenantId,
      transactionType: "bank_statement_line",
      transactionId: l.id,
      exceptionType: "unreconciled_bank_transaction",
      severity: rule.severity,
      description: `Unreconciled ${days} days: ${l.description ?? "bank transaction"}`,
      dedupeKey: dk,
    });
  }
  return found;
}

// Any point where a cash/bank ledger account's running balance goes
// negative — computed chronologically from posted journal lines. Reversed
// entries are still included here (at their own entryDate), same as their
// reversals (dated when the reversal was posted) — each affects the running
// balance from its own date forward, exactly like the real books; excluding
// a reversed original would count its reversal's correction without ever
// counting the thing it corrected.
async function detectNegativeBalances(tenantId: string, seen: Set<string>): Promise<NewException[]> {
  const bankAccountRows = await db.select().from(bankAccounts).where(eq(bankAccounts.tenantId, tenantId));
  const found: NewException[] = [];

  for (const ba of bankAccountRows) {
    const lines = await db
      .select({ entryDate: journalEntries.entryDate, debit: journalLines.debitAmount, credit: journalLines.creditAmount, entryId: journalEntries.id })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, ba.chartOfAccountsLink)))
      .orderBy(asc(journalEntries.entryDate));

    let running = Number(ba.openingBalance);
    for (const l of lines) {
      running += Number(l.debit) - Number(l.credit);
      if (running < -0.01) {
        const dk = dedupeKey("negative_cash_balance", ba.id, l.entryId);
        if (!seen.has(dk)) {
          found.push({
            tenantId,
            transactionType: "bank_account",
            transactionId: ba.id,
            exceptionType: "negative_cash_balance",
            severity: "blocking",
            description: `${ba.accountName} went negative (${running.toFixed(2)}) on ${l.entryDate}`,
            dedupeKey: dk,
          });
        }
        break; // one exception per account is enough until resolved
      }
    }
  }
  return found;
}

// Journal entries posted (createdAt) well after the date they're dated for
// — threshold comes from an active "backdated_transaction" rule; skipped if
// none is configured.
async function detectBackdatedTransactions(tenantId: string, seen: Set<string>): Promise<NewException[]> {
  const [rule] = await db
    .select()
    .from(complianceRules)
    .where(and(eq(complianceRules.tenantId, tenantId), eq(complianceRules.checkType, "backdated_transaction"), eq(complianceRules.isActive, true)))
    .limit(1);
  if (!rule || !rule.thresholdValue) return [];

  const thresholdDays = Number(rule.thresholdValue);
  const found: NewException[] = [];

  const rows = await db
    .select({ id: journalEntries.id, entryDate: journalEntries.entryDate, createdAt: journalEntries.createdAt, memo: journalEntries.memo })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId));

  for (const r of rows) {
    const days = Math.floor((r.createdAt.getTime() - new Date(r.entryDate + "T00:00:00Z").getTime()) / 86400000);
    if (days < thresholdDays) continue;
    const dk = dedupeKey("backdated_transaction", r.id);
    if (seen.has(dk)) continue;
    found.push({
      tenantId,
      transactionType: "journal_entry",
      transactionId: r.id,
      exceptionType: "backdated_transaction",
      severity: rule.severity,
      description: `Posted ${days} days after its entry date (${r.entryDate}): ${r.memo ?? ""}`,
      dedupeKey: dk,
    });
  }
  return found;
}

// Suppliers with transactions but no PAN on file — only runs if a
// "missing_pan" rule is active for purchases/expenses.
async function detectMissingPan(tenantId: string, seen: Set<string>): Promise<NewException[]> {
  const [rule] = await db
    .select()
    .from(complianceRules)
    .where(and(eq(complianceRules.tenantId, tenantId), eq(complianceRules.checkType, "missing_pan"), eq(complianceRules.isActive, true)))
    .limit(1);
  if (!rule) return [];

  const found: NewException[] = [];
  const vendorRows = await db.select().from(vendors).where(and(eq(vendors.tenantId, tenantId), sql`${vendors.panNumber} is null or ${vendors.panNumber} = ''`));

  for (const v of vendorRows) {
    const [{ value: billCount }] = await db.select({ value: sql<number>`count(*)::int` }).from(purchaseBills).where(eq(purchaseBills.vendorId, v.id));
    if (billCount === 0) continue;
    const dk = dedupeKey("missing_pan", v.id);
    if (seen.has(dk)) continue;
    found.push({
      tenantId,
      transactionType: "vendor",
      transactionId: v.id,
      exceptionType: "missing_pan",
      severity: rule.severity,
      description: `Supplier "${v.name}" has transactions but no PAN on file`,
      dedupeKey: dk,
    });
  }
  return found;
}

// Runs every detector, inserts genuinely new exceptions (by dedupeKey), and
// returns how many were created — call this from a "Run Scan" button, not
// automatically on every page load.
export async function runComplianceScan(tenantId: string): Promise<number> {
  const seen = await alreadyOpenKeys(tenantId);

  const batches = await Promise.all([
    detectDuplicateInvoices(tenantId, seen),
    detectUnreconciledBankLines(tenantId, seen),
    detectNegativeBalances(tenantId, seen),
    detectBackdatedTransactions(tenantId, seen),
    detectMissingPan(tenantId, seen),
  ]);

  const toInsert = batches.flat();
  if (toInsert.length === 0) return 0;

  await db.insert(complianceExceptions).values(toInsert);
  return toInsert.length;
}
