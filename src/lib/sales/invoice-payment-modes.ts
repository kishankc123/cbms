import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, paymentAllocations, payments } from "@/db/schema";

/**
 * How each invoice was paid, for the invoice list: the payment mode of every payment received against it. Payments taken when
 * the invoice was entered come from their journal lines (the original entries, never the reversals of edited or voided ones) (one per payment line, so a split payment shows every mode); payments
 * recorded later come from the Payments module. A payment made before modes existed shows the account it went into instead.
 */
export async function paymentModesByInvoice(tenantId: string, invoiceIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (invoiceIds.length === 0) return out;
  const add = (invoiceId: string, label: string | null) => {
    if (!label) return;
    const list = (out[invoiceId] ??= []);
    if (!list.includes(label)) list.push(label);
  };

  const embedded = await db
    .select({ invoiceId: journalEntries.sourceId, mode: journalLines.paymentModeName, account: accounts.name })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "receipt"), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId), inArray(journalEntries.sourceId, invoiceIds), gt(journalLines.debitAmount, "0")))
    .orderBy(asc(journalEntries.createdAt));
  for (const r of embedded) if (r.invoiceId) add(r.invoiceId, r.mode ?? r.account);

  const later = await db
    .select({ invoiceId: paymentAllocations.targetId, mode: payments.paymentModeName, account: accounts.name })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(accounts, eq(accounts.id, payments.accountId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "standalone"), ne(payments.status, "voided"), eq(paymentAllocations.targetType, "sales_invoice"), inArray(paymentAllocations.targetId, invoiceIds)))
    .orderBy(asc(payments.paymentDate));
  for (const r of later) add(r.invoiceId, r.mode ?? r.account);
  return out;
}
