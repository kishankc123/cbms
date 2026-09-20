import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { peekNextVoucher } from "@/lib/ledger/voucher";
import { JournalEntryForm } from "./journal-entry-form";
import { reverseEntry } from "./actions";
import { D } from "@/components/calendar/date-text";

export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const showHistory = (await searchParams).history === "1";

  const [accountList, nextVoucher] = await Promise.all([
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true)))
      .orderBy(asc(accounts.code)),
    peekNextVoucher(session.tenantId),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Journal Entries</h1>

      <JournalEntryForm accounts={accountList} nextVoucher={nextVoucher} />

      {showHistory ? (
        <History tenantId={session.tenantId} accountList={accountList} />
      ) : (
        <Link href="/journal?history=1" className="inline-block text-sm text-[var(--color-primary)] hover:underline">
          Show entry history
        </Link>
      )}
    </div>
  );
}

// Entry history is hidden by default and only loaded when asked for.
async function History({ tenantId, accountList }: { tenantId: string; accountList: { id: string; code: string; name: string }[] }) {
  const entries = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(200);
  const lines = entries.length ? await db.select().from(journalLines).where(inArray(journalLines.journalEntryId, entries.map((e) => e.id))) : [];
  const linesByEntry = new Map<string, typeof lines>();
  for (const line of lines) linesByEntry.set(line.journalEntryId, [...(linesByEntry.get(line.journalEntryId) ?? []), line]);
  const accountById = new Map(accountList.map((a) => [a.id, a]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Entry history</h2>
        <Link href="/journal" className="text-sm text-[var(--color-primary)] hover:underline">
          Hide entry history
        </Link>
      </div>
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                <D value={entry.entryDate} /> — {entry.memo || entry.sourceType}
                {entry.isReversed && <span className="ml-2 text-xs text-amber-600">(reversed)</span>}
                {entry.reversalOfId && <span className="ml-2 text-xs text-gray-500">(reversal entry)</span>}
              </p>
              <p className="text-xs text-gray-500">
                {entry.referenceNumber ? `Voucher ${entry.referenceNumber} · ` : ""}source: {entry.sourceType}
              </p>
            </div>
            {!entry.isReversed && !entry.reversalOfId && (
              <form action={reverseEntry}>
                <input type="hidden" name="journalEntryId" value={entry.id} />
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  Reverse
                </button>
              </form>
            )}
          </div>
          <table className="w-full text-sm mt-3">
            <tbody>
              {(linesByEntry.get(entry.id) ?? []).map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="py-1">
                    {accountById.get(l.accountId)?.code} {accountById.get(l.accountId)?.name}
                  </td>
                  <td className="py-1 text-right w-24">{Number(l.debitAmount) > 0 ? Number(l.debitAmount).toFixed(2) : ""}</td>
                  <td className="py-1 text-right w-24">{Number(l.creditAmount) > 0 ? Number(l.creditAmount).toFixed(2) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {entries.length === 0 && <p className="text-sm text-gray-500">No journal entries yet.</p>}
    </div>
  );
}
