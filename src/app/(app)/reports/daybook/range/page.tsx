import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { guardView } from "@/components/page-guard";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { requireTenantSession } from "@/lib/session";
import { addDays, addMonths, formatDate, monthRange, todayIso, validateADDate } from "@/lib/calendar";
import { clampRange, loadDaybookRange } from "@/lib/ledger/daybook";
import { RangeView } from "./range-view";

// The Daybook over several days: a row for every day and the period added up. Same permission and same figures as the one-day Daybook.
export default async function DaybookRangePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const session = await requireTenantSession();
  const sp = await searchParams;
  const today = todayIso();
  const valid = (v: unknown) => (typeof v === "string" && validateADDate(v) ? v : null);
  const thisMonth = monthRange(session.calendar, today);
  const to = (() => { const t = valid(sp.to) ?? today; return t > today ? today : t; })();
  const asked = valid(sp.from) ?? thisMonth.from;
  const { from, to: end, trimmed } = clampRange(asked > to ? to : asked, to);

  const lastMonth = monthRange(session.calendar, addMonths(session.calendar, today, -1));
  const presets = [
    { label: "Last 7 days", from: addDays(today, -6), to: today },
    { label: "This month", from: thisMonth.from, to: today },
    { label: "Last month", from: lastMonth.from, to: lastMonth.to },
  ];

  const [data, [tenant]] = await Promise.all([loadDaybookRange(session.tenantId, from, end), db.select({ name: tenants.companyName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)]);
  const info = {
    company: tenant?.name ?? "",
    dateLabel: `${formatDate(from, session.calendar, "long")} to ${formatDate(end, session.calendar, "long")}`,
    otherDateLabel: "",
    currency: "",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <BackButton href="/reports/daybook" label="Back to Daybook" />
        <PageHeader title="Daybook over several days" description="A row for every day, and the whole period added up the same way as a single day." className="!mb-0" />
      </div>
      <RangeView data={data} info={info} today={today} presets={presets} trimmed={trimmed} calendar={session.calendar} />
    </div>
  );
}
