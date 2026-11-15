import { requireTenantSession, can } from "@/lib/session";
import { clampToBooksStart, getBooksStart } from "@/lib/ledger/books-start";
import { BooksStartNote } from "../books-start-note";
import { cashBook } from "@/lib/ledger/reports";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { CashBookView } from "./cash-book-view";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function CashBookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [fiscal, activeFiscalYear] = await Promise.all([getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  // The books begin on the books start date: a report cannot start before it, and the opening balances are then its opening line.
  const booksStart = (await getBooksStart(session.tenantId)).date;
  const span = clampToBooksStart({ from, to }, booksStart);
  from = span.from;

  const { accountLabels, openingBalance, lines } = await cashBook(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Cash Book" className="!mb-0" />
      </div>
      <BooksStartNote date={booksStart} calendar={session.calendar} clamped={span.clamped} beforeBooks={span.beforeBooks} />
      <CashBookView accountLabels={accountLabels} openingBalance={openingBalance} lines={lines} from={from} to={to} fiscal={fiscal} />
    </div>
  );
}
