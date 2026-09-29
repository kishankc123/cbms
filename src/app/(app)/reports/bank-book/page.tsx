import Link from "next/link";
import { and, asc, eq, or, like } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { generalLedger } from "@/lib/ledger/reports";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { BankBookView } from "./bank-book-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function BankBookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const list = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.isActive, true), or(eq(accounts.code, "1010"), like(accounts.code, "1010.%"))))
    .orderBy(asc(accounts.code));

  const accountId = typeof sp.account === "string" && list.some((a) => a.id === sp.account) ? sp.account : null;
  const ledger = accountId
    ? await generalLedger(session.tenantId, accountId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Bank Book</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <BankBookView
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
              sourceType: l.sourceType,
              sourceId: l.sourceId,
            })),
          }
        }
      />
    </div>
  );
}
