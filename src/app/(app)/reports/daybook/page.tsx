import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { guardView } from "@/components/page-guard";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { can, requireTenantSession } from "@/lib/session";
import { addDays, formatDate, monthRange, todayIso, validateADDate, weekdayOf } from "@/lib/calendar";
import { loadDaybookPage } from "@/lib/ledger/daybook";
import { loadCashCounts } from "@/lib/ledger/cash-count";
import { cashAccountRows } from "@/lib/dashboard/cash-flow";
import { DaybookView } from "./daybook-view";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The Daybook: one day of the business on one page. Everything comes from the ledger, so it always agrees with the other reports. It sits with the
// cash reports, so it needs the same permission as the Cash Book.
export default async function DaybookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const session = await requireTenantSession();
  const sp = await searchParams;
  const today = todayIso();
  const asked = typeof sp.date === "string" && validateADDate(sp.date) ? sp.date : today;
  const day = asked > today ? today : asked; // there is nothing to report on a day that hasn't happened

  const monthFrom = monthRange(session.calendar, day).from;
  const [page, counts, cashRows, [tenant]] = await Promise.all([loadDaybookPage(session.tenantId, day, today, monthFrom), loadCashCounts(session.tenantId, day), cashAccountRows(session.tenantId), db.select({ name: tenants.companyName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)]);
  // Only the cash in hand is counted by hand; bank balances come from statements.
  const countAccounts = cashRows
    .filter((a) => a.isActive && (a.code === "1000" || a.code.startsWith("1000.")))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, name: a.name, book: page.book.accounts.find((x) => x.accountId === a.id)?.closing ?? 0, saved: counts.find((c) => c.accountId === a.id) ?? null }));
  // What was counted against what the books said, over the cash accounts that have a saved count for the day.
  const saved = countAccounts.filter((a) => a.saved);
  const cashCount = saved.length > 0 ? { counted: Math.round(saved.reduce((s, a) => s + a.saved!.counted, 0) * 100) / 100, books: Math.round(saved.reduce((s, a) => s + a.book, 0) * 100) / 100 } : null;
  const other = session.calendar === "BS" ? "AD" : "BS";
  const info = {
    company: tenant?.name ?? "",
    dateLabel: `${WEEKDAYS[weekdayOf(day)]}, ${formatDate(day, session.calendar, "long")}`,
    otherDateLabel: `${formatDate(day, other, "long")} ${other}`,
    currency: "",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <BackButton href="/reports" label="Back to Reports" />
        <PageHeader title="Daybook" description="One day of your business: sales, purchases and expenses by how they were paid, and your cash and bank balances." className="!mb-0" />
      </div>
      <DaybookView page={page} countAccounts={countAccounts} canCount={can(session, "bank_reconciliation", "edit")} monthLabel={formatDate(monthFrom, session.calendar, "long")}
        cashCount={cashCount} info={info} day={day} today={today} prevDay={addDays(day, -1)} nextDay={day < today ? addDays(day, 1) : null} />
    </div>
  );
}
