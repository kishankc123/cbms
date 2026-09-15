import { eq, desc, asc } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { JournalEntryForm } from "./journal-entry-form";
import { reverseEntry } from "./actions";

export default async function JournalPage() {
  const session = await requireTenantSession();

  const [accountList, entries] = await Promise.all([
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.tenantId, session.tenantId))
      .orderBy(asc(accounts.code)),
    db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.tenantId, session.tenantId))
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt)),
  ]);

  const entryIds = entries.map((e) => e.id);
  const allLines = entryIds.length
    ? await db.select().from(journalLines)
    : [];
  const linesByEntry = new Map<string, typeof allLines>();
  for (const line of allLines) {
    if (!entryIds.includes(line.journalEntryId)) continue;
    const arr = linesByEntry.get(line.journalEntryId) ?? [];
    arr.push(line);
    linesByEntry.set(line.journalEntryId, arr);
  }
  const accountById = new Map(accountList.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Journal Entries</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Manual posting for testing the ledger engine. Sales, Purchases, and Expenses screens will
        post here automatically once built.
      </p>

      <JournalEntryForm accounts={accountList} />

      <div className="space-y-3">
        {entries.map((entry) => {
          const lines = linesByEntry.get(entry.id) ?? [];
          return (
            <div key={entry.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {entry.entryDate} — {entry.memo || entry.sourceType}
                    {entry.isReversed && (
                      <span className="ml-2 text-xs text-amber-600">(reversed)</span>
                    )}
                    {entry.reversalOfId && (
                      <span className="ml-2 text-xs text-gray-500">(reversal entry)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {entry.referenceNumber} · source: {entry.sourceType}
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
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="py-1">{accountById.get(l.accountId)?.code} {accountById.get(l.accountId)?.name}</td>
                      <td className="py-1 text-gray-500">{l.description}</td>
                      <td className="py-1 text-right w-24">{Number(l.debitAmount) > 0 ? Number(l.debitAmount).toFixed(2) : ""}</td>
                      <td className="py-1 text-right w-24">{Number(l.creditAmount) > 0 ? Number(l.creditAmount).toFixed(2) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {entries.length === 0 && <p className="text-sm text-gray-500">No journal entries yet.</p>}
      </div>
    </div>
  );
}
