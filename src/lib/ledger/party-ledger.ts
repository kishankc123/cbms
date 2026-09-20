import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import type { PartyLine } from "./party-statement";

export * from "./party-statement";

/** All lines posted to each of the given accounts, oldest first. */
export async function getPartyLines(tenantId: string, accountIds: string[]): Promise<Map<string, PartyLine[]>> {
  const out = new Map<string, PartyLine[]>(accountIds.map((id) => [id, []]));
  if (accountIds.length === 0) return out;
  const rows = await db
    .select({
      accountId: journalLines.accountId,
      date: journalEntries.entryDate,
      debit: journalLines.debitAmount,
      credit: journalLines.creditAmount,
      sourceType: journalEntries.sourceType,
      reference: journalEntries.referenceNumber,
      memo: journalEntries.memo,
      reversalOfId: journalEntries.reversalOfId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt));
  for (const r of rows) {
    out.get(r.accountId)!.push({ date: r.date, debit: Number(r.debit), credit: Number(r.credit), sourceType: r.sourceType, reference: r.reference || null, memo: r.memo || null, isReversal: r.reversalOfId !== null });
  }
  return out;
}
