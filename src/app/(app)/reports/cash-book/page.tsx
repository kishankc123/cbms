import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { cashBook } from "@/lib/ledger/reports";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { CashBookView } from "./cash-book-view";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function CashBookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const { accountLabels, openingBalance, lines } = await cashBook(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Cash Book</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <CashBookView accountLabels={accountLabels} openingBalance={openingBalance} lines={lines} from={from} to={to} fiscal={fiscal} />
    </div>
  );
}
