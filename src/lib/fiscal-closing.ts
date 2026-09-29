import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { salesInvoices, purchaseBills, items, inventorySettings, fiscalYears } from "@/db/schema";
import { trialBalance, profitAndLoss, balanceSheet } from "@/lib/ledger/reports";
import { getFiscalYearById, type FiscalYear } from "@/lib/fiscal";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReadinessIssue = { label: string; count: number };

export type YearEndReadiness = {
  fiscalYear: FiscalYear;
  issues: ReadinessIssue[];
  canClose: boolean;
  trialBalance: Awaited<ReturnType<typeof trialBalance>>;
  profitAndLoss: Awaited<ReturnType<typeof profitAndLoss>>;
  balanceSheet: Awaited<ReturnType<typeof balanceSheet>>;
};

/**
 * Everything the year-end closing wizard needs to know before letting a fiscal year close: the
 * validation checklist (spec's "draft transactions, unposted transactions, negative inventory") and
 * the financial-review figures, all read from the existing report functions — never re-derived, so
 * this can never disagree with the Trial Balance / P&L / Balance Sheet reports themselves.
 */
export async function getYearEndReadiness(tenantId: string, fiscalYearId: string): Promise<YearEndReadiness> {
  const fiscalYear = await getFiscalYearById(tenantId, fiscalYearId);
  if (!fiscalYear) throw new Error("Fiscal year not found");

  const periodStart = new Date(fiscalYear.startDate + "T00:00:00Z");
  const periodEnd = new Date(fiscalYear.endDate + "T00:00:00Z");

  const [draftInvoices, draftBills, [invSettings], negativeItems, tb, pnl, bs] = await Promise.all([
    db
      .select({ id: salesInvoices.id })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.status, "draft"))),
    db
      .select({ id: purchaseBills.id })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.status, "draft"))),
    db.select({ allowNegativeStock: inventorySettings.allowNegativeStock }).from(inventorySettings).where(eq(inventorySettings.tenantId, tenantId)).limit(1),
    db.select({ id: items.id }).from(items).where(and(eq(items.tenantId, tenantId), lt(items.stockQuantity, "0"))),
    trialBalance(tenantId, periodEnd),
    profitAndLoss(tenantId, periodStart, periodEnd),
    balanceSheet(tenantId, periodEnd),
  ]);

  const issues: ReadinessIssue[] = [];
  if (draftInvoices.length > 0) issues.push({ label: "Draft sales invoices not yet posted", count: draftInvoices.length });
  if (draftBills.length > 0) issues.push({ label: "Draft purchase bills not yet posted", count: draftBills.length });
  if (!tb.isBalanced) issues.push({ label: "Trial balance is not balanced", count: 1 });
  if (!bs.isBalanced) issues.push({ label: "Balance sheet does not balance (assets ≠ liabilities + equity)", count: 1 });
  if (!invSettings?.allowNegativeStock && negativeItems.length > 0) issues.push({ label: "Items with negative stock on hand", count: negativeItems.length });

  return { fiscalYear, issues, canClose: issues.length === 0, trialBalance: tb, profitAndLoss: pnl, balanceSheet: bs };
}

export type OpeningBalanceCheck = { label: string; closingBalance: number; openingBalance: number; matched: boolean };

/**
 * Spec's opening-balance reconciliation: the closed year's final position vs. the very next fiscal
 * year's first-day position. This system computes the Balance Sheet live from the ledger rather than
 * posting separate closing/opening journal entries (see balanceSheet()'s own retained-earnings comment),
 * so with nothing posted in the gap between the two dates these already match by construction — the
 * check exists to catch the case where something unexpectedly was.
 */
export async function getOpeningBalanceReconciliation(tenantId: string, closedFiscalYearId: string): Promise<OpeningBalanceCheck[] | null> {
  const closed = await getFiscalYearById(tenantId, closedFiscalYearId);
  if (!closed) throw new Error("Fiscal year not found");

  const candidates = await db.select().from(fiscalYears).where(eq(fiscalYears.tenantId, tenantId));
  const next = candidates.filter((fy) => fy.startDate > closed.endDate).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (!next) return null; // Next fiscal year not created yet — nothing to reconcile against.

  const closingDate = new Date(closed.endDate + "T00:00:00Z");
  const openingDate = new Date(next.startDate + "T00:00:00Z");
  const [closingBs, openingBs] = await Promise.all([balanceSheet(tenantId, closingDate), balanceSheet(tenantId, openingDate)]);

  const rows: OpeningBalanceCheck[] = [
    { label: "Total Assets", closingBalance: closingBs.totalAssets, openingBalance: openingBs.totalAssets, matched: false },
    { label: "Total Liabilities", closingBalance: closingBs.totalLiabilities, openingBalance: openingBs.totalLiabilities, matched: false },
    { label: "Total Equity", closingBalance: round2(closingBs.totalEquity), openingBalance: round2(openingBs.totalEquity), matched: false },
  ];
  return rows.map((r) => ({ ...r, matched: r.closingBalance === r.openingBalance }));
}
