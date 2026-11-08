import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { guardView } from "@/components/page-guard";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { requireTenantSession } from "@/lib/session";
import { addDays, formatDate, todayIso, validateADDate, weekdayOf } from "@/lib/calendar";
import { loadDaybookPage } from "@/lib/ledger/daybook";
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

  const [page, [tenant]] = await Promise.all([loadDaybookPage(session.tenantId, day), db.select({ name: tenants.companyName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)]);
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
      <DaybookView page={page} compareLabel={`${WEEKDAYS[weekdayOf(day)]} ${formatDate(addDays(day, -7), session.calendar, "long")}`} info={info} day={day} today={today} prevDay={addDays(day, -1)} nextDay={day < today ? addDays(day, 1) : null} />
    </div>
  );
}
