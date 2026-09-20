import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { generalLedger } from "@/lib/ledger/reports";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { LedgerView } from "./ledger-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const dflt = presetRange("this_fiscal_year", session.calendar, todayIso(), fiscal);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const list = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, subCategory: accounts.subCategory })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.code));

  const accountId = typeof sp.account === "string" && list.some((a) => a.id === sp.account) ? sp.account : null;
  const ledger = accountId
    ? await generalLedger(session.tenantId, accountId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Ledger</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Financial reports
        </Link>
      </div>
      <LedgerView
        accounts={list}
        accountId={accountId}
        from={from}
        to={to}
        fiscal={fiscal}
        ledger={
          ledger && {
            accountLabel: `${ledger.account.code} — ${ledger.account.name}`,
            openingBalance: ledger.openingBalance,
            lines: ledger.lines.map((l) => ({
              entryDate: l.entryDate,
              referenceNumber: l.referenceNumber,
              memo: l.memo,
              description: l.description,
              debit: l.debit,
              credit: l.credit,
              runningBalance: l.runningBalance,
            })),
          }
        }
      />
    </div>
  );
}
