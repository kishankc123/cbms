import { asc, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, users } from "@/db/schema";
import { resolveSourceLink } from "./source-link";

// One journal entry as the ledger report's pop-up shows it: what it is, when, and every line it posted. Plain server helper;
// the action in reports/ledger checks the permission first.

export type EntryDetail = {
  id: string;
  entryDate: string;
  referenceNumber: string | null;
  memo: string | null;
  /** What posted it, in words ("Sales invoice", "Payment", "Manual journal"...). */
  kind: string;
  /** Where the record behind it can be opened, if there is a screen for it. */
  link: { label: string; href: string } | null;
  /** True for an entry that reverses an earlier one (an edit or a void). */
  isReversal: boolean;
  /** True once a later entry has reversed this one. */
  isReversed: boolean;
  createdBy: string | null;
  lines: { accountId: string; code: string; name: string; description: string | null; debit: number; credit: number; mode: string | null }[];
  totalDebit: number;
  totalCredit: number;
};

const KIND: Record<string, string> = {
  sale: "Sales invoice",
  receipt: "Payment received",
  sales_return: "Sales return",
  purchase: "Purchase",
  purchase_return: "Purchase return",
  expense: "Expense",
  payment: "Payment",
  manual: "Manual journal",
  inter_transfer: "Inter-transfer",
  payroll: "Payroll",
  asset_purchase: "Asset purchase",
  asset_depreciation: "Asset depreciation",
  asset_disposal: "Asset disposal",
  asset_writeoff: "Asset write-off",
  tax_assessment: "Tax charge",
  bank_adjustment: "Bank adjustment",
  stock_adjustment: "Stock adjustment",
  adjustment: "Stock adjustment",
  opening_balance: "Opening balance",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function journalEntryDetail(tenantId: string, entryId: string): Promise<EntryDetail | null> {
  const [entry] = await db
    .select({ e: journalEntries, by: users.name })
    .from(journalEntries)
    .leftJoin(users, eq(users.id, journalEntries.createdBy))
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.tenantId, tenantId)))
    .limit(1);
  if (!entry) return null;

  const lines = await db
    .select({ accountId: journalLines.accountId, code: accounts.code, name: accounts.name, description: journalLines.description, debit: journalLines.debitAmount, credit: journalLines.creditAmount, mode: journalLines.paymentModeName })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.journalEntryId, entryId))
    // Debits first, then credits, the way a voucher reads.
    .orderBy(asc(accounts.code));
  const mapped = lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })).sort((a, b) => (a.debit > 0 ? 0 : 1) - (b.debit > 0 ? 0 : 1));
  return {
    id: entry.e.id,
    entryDate: entry.e.entryDate,
    referenceNumber: entry.e.referenceNumber,
    memo: entry.e.memo,
    kind: KIND[entry.e.sourceType] ?? "Journal entry",
    link: resolveSourceLink(entry.e.sourceType),
    isReversal: entry.e.reversalOfId !== null,
    isReversed: entry.e.isReversed,
    createdBy: entry.by,
    lines: mapped,
    totalDebit: round2(mapped.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(mapped.reduce((s, l) => s + l.credit, 0)),
  };
}
