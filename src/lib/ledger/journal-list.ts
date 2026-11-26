import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, users } from "@/db/schema";
import { entryState, isOwnEntry, OWN_VOUCHER_PATTERN, sourceLabel, SOURCE_LABELS, type EntryState } from "./journal-rules";

// The list of journal entries for the Journal Entries screen, with each entry's lines.

export type JournalFilters = {
  /** Voucher number, narration, or an amount. */
  q?: string;
  from?: string;
  to?: string;
  /** "manual" (typed in on this screen, the usual view), "all", or one source type. */
  source?: string;
  accountId?: string;
  status?: "" | EntryState;
  /** One entry only (the printed voucher). */
  entryId?: string;
};

export type JournalLineRow = { accountId: string; code: string; name: string; note: string; debit: number; credit: number };
export type JournalRow = {
  id: string;
  date: string;
  voucher: string;
  narration: string;
  source: string;
  own: boolean;
  state: EntryState;
  amount: number;
  enteredBy: string;
  enteredAt: string;
  lines: JournalLineRow[];
};

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const round2 = (n: number) => Math.round(n * 100) / 100;

function conditions(tenantId: string, f: JournalFilters): SQL[] {
  const where: SQL[] = [eq(journalEntries.tenantId, tenantId)];
  if (f.from && isDate(f.from)) where.push(gte(journalEntries.entryDate, f.from));
  if (f.to && isDate(f.to)) where.push(lte(journalEntries.entryDate, f.to));

  if (f.entryId && isUuid(f.entryId)) where.push(eq(journalEntries.id, f.entryId));

  const source = f.source || "manual";
  if (source === "manual") where.push(eq(journalEntries.sourceType, "manual"), isNull(journalEntries.sourceId), sql`${journalEntries.referenceNumber} ~ ${OWN_VOUCHER_PATTERN}`);
  else if (source !== "all" && source in SOURCE_LABELS) where.push(eq(journalEntries.sourceType, source as typeof journalEntries.$inferSelect.sourceType));

  if (f.status === "posted") where.push(eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId));
  if (f.status === "reversed") where.push(eq(journalEntries.isReversed, true), isNull(journalEntries.reversalOfId));
  if (f.status === "reversal") where.push(isNotNull(journalEntries.reversalOfId));

  if (f.accountId && isUuid(f.accountId)) where.push(sql`exists (select 1 from ${journalLines} l where l.journal_entry_id = ${journalEntries.id} and l.account_id = ${f.accountId})`);

  const q = (f.q ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const matches: SQL[] = [ilike(journalEntries.memo, like), ilike(journalEntries.referenceNumber, like)];
    const amount = Number(q.replace(/,/g, ""));
    // A number also finds an entry by one of its lines' amounts or by its total.
    if (Number.isFinite(amount) && amount > 0) {
      matches.push(sql`exists (select 1 from ${journalLines} l where l.journal_entry_id = ${journalEntries.id} and (l.debit_amount = ${amount} or l.credit_amount = ${amount}))`);
      matches.push(sql`(select coalesce(sum(l.debit_amount), 0) from ${journalLines} l where l.journal_entry_id = ${journalEntries.id}) = ${amount}`);
    }
    where.push(or(...matches)!);
  }
  return where;
}

/** One page of entries, newest first. `hasMore` says whether there are further ones after this page. */
export async function listJournal(tenantId: string, filters: JournalFilters, page: { limit: number; offset?: number }): Promise<{ rows: JournalRow[]; hasMore: boolean }> {
  const found = await db
    .select({ e: journalEntries, who: users.name })
    .from(journalEntries)
    .leftJoin(users, eq(users.id, journalEntries.createdBy))
    .where(and(...conditions(tenantId, filters)))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt), desc(journalEntries.id))
    .limit(page.limit + 1)
    .offset(page.offset ?? 0);
  const hasMore = found.length > page.limit;
  const shown = found.slice(0, page.limit);
  const lines = shown.length
    ? await db
        .select({ entryId: journalLines.journalEntryId, accountId: journalLines.accountId, code: accounts.code, name: accounts.name, note: journalLines.description, debit: journalLines.debitAmount, credit: journalLines.creditAmount })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.journalEntryId, shown.map((r) => r.e.id))))
        .orderBy(desc(journalLines.debitAmount), asc(accounts.code))
    : [];
  const linesOf = new Map<string, JournalLineRow[]>();
  for (const l of lines) {
    const list = linesOf.get(l.entryId) ?? [];
    list.push({ accountId: l.accountId, code: l.code, name: l.name, note: l.note ?? "", debit: Number(l.debit), credit: Number(l.credit) });
    linesOf.set(l.entryId, list);
  }
  return {
    hasMore,
    rows: shown.map(({ e, who }) => {
      const own = linesOf.get(e.id) ?? [];
      return {
        id: e.id,
        date: e.entryDate,
        voucher: e.referenceNumber ?? "",
        narration: e.memo ?? "",
        source: sourceLabel(e),
        own: isOwnEntry(e),
        state: entryState(e),
        amount: round2(own.reduce((s, l) => s + l.debit, 0)),
        enteredBy: who ?? "",
        enteredAt: e.createdAt.toISOString(),
        lines: own,
      };
    }),
  };
}

/** One entry of this organization, or null. */
export async function getJournalEntry(tenantId: string, entryId: string): Promise<JournalRow | null> {
  if (!isUuid(entryId)) return null;
  return (await listJournal(tenantId, { source: "all", entryId }, { limit: 1 })).rows[0] ?? null;
}
