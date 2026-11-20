import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, journalEntries, journalLines } from "@/db/schema";
import { findControlAccount } from "@/lib/ledger/control-accounts";

// Once a VAT return has been filed, the figures of its period are final: nothing that the return counts can be added, changed or voided inside it. The
// return counts every sales invoice and return, every purchase bill and return, and the expenses that carry VAT, so those are what is locked. A period
// that was filed before the organization started using the system is not locked: its history still has to be entered.

/** The statuses of a VAT obligation that mean the return has gone in. */
export const VAT_FILED_STATUSES = ["filed", "paid", "partially_paid"] as const;

const ALWAYS = new Set(["sale", "sales_return", "purchase", "purchase_return"]);

export async function filedVatPeriod(tenantId: string, date: string) {
  const [p] = await db
    .select({ id: complianceObligations.id, label: complianceObligations.periodLabel, start: complianceObligations.periodStart, end: complianceObligations.periodEnd })
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.taxTypeKey, "vat"),
        eq(complianceObligations.filedBeforeSystem, false),
        inArray(complianceObligations.status, [...VAT_FILED_STATUSES]),
        lte(complianceObligations.periodStart, date),
        gte(complianceObligations.periodEnd, date)
      )
    )
    .limit(1);
  return p ?? null;
}

/** Whether an entry of this kind is part of the VAT return: always for sales and purchases, for an expense only when it carries VAT (it touches Tax Receivable). */
async function inVatReturn(tenantId: string, sourceType: string, accountIds: string[]): Promise<boolean> {
  if (ALWAYS.has(sourceType)) return true;
  if (sourceType !== "expense") return false;
  const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
  return Boolean(taxReceivable && accountIds.includes(taxReceivable.id));
}

const message = (label: string, date: string, action: "post" | "change") =>
  `The VAT return for ${label} has been filed, so its figures are final. ${action === "post" ? `Nothing can be recorded with the date ${date}, which is inside it` : `This entry is dated ${date}, inside it, so it can't be changed or voided`}. Date it in the open period, or ask an administrator to reopen the filing (Compliance, VAT: mark the return as not filed).`;

/** Refuses an entry that the filed VAT return of its date would count. */
export async function assertVatOpenForEntry(tenantId: string, date: string, sourceType: string, accountIds: string[], action: "post" | "change") {
  if (!(await inVatReturn(tenantId, sourceType, accountIds))) return;
  const filed = await filedVatPeriod(tenantId, date);
  if (filed) throw new Error(message(filed.label, date, action));
}

/** The same check for entries that already exist, all of them before any is touched (a void reverses several). */
export async function assertEntriesVatOpen(tenantId: string, entryIds: string[]) {
  if (entryIds.length === 0) return;
  const entries = await db.select({ id: journalEntries.id, date: journalEntries.entryDate, sourceType: journalEntries.sourceType }).from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), inArray(journalEntries.id, entryIds)));
  const relevant = entries.filter((e) => ALWAYS.has(e.sourceType) || e.sourceType === "expense");
  if (relevant.length === 0) return;
  const lines = await db.select({ entryId: journalLines.journalEntryId, accountId: journalLines.accountId }).from(journalLines).where(inArray(journalLines.journalEntryId, relevant.map((e) => e.id)));
  for (const e of relevant) {
    await assertVatOpenForEntry(tenantId, e.date, e.sourceType, lines.filter((l) => l.entryId === e.id).map((l) => l.accountId), "change");
  }
}
