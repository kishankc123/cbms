import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { requireTenantSession, requireUserSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { getActiveFiscalYear } from "@/lib/fiscal";
import { HORIZONS, parseHorizon } from "@/lib/dashboard/forecast";
import { loadPlanning, vendorChoices } from "@/lib/dashboard/planning";
import { DashboardHeader } from "../dashboard-header";
import { PlanningWorkspace } from "./planning-workspace";

export default async function PlanningTab({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("chart_of_accounts");
  if (denied) return denied;
  const session = await requireTenantSession();
  const user = await requireUserSession();
  const sp = await searchParams;

  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const today = todayIso();
  const horizon = parseHorizon(typeof sp.days === "string" ? sp.days : "90");
  const [{ base, events, shares }, vendors] = await Promise.all([loadPlanning(session.tenantId, today, horizon), vendorChoices(session.tenantId)]);

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-2">Look ahead</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Look ahead">
          {HORIZONS.map((d) => (
            <Link key={d} href={`/dashboard/planning?days=${d}`} aria-current={d === horizon ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs transition-colors ${d === horizon ? "border-accent bg-surface-2 font-medium text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink"}`}>
              {d} days
            </Link>
          ))}
        </div>
        <span className="text-xs text-ink-2">The forecast comes from the Forecast tab. Plans are added on top of it.</span>
      </div>

      <PlanningWorkspace
        openingCash={base.forecast.openingCash}
        days={base.forecast.days}
        reserve={base.forecast.reserve}
        horizonDays={horizon}
        events={events}
        vendors={vendors}
        collectedShare={shares.collectedShare}
        variableCostShare={shares.variableCostShare}
        today={today}
        canEdit={can(session, "expenses", "create")}
      />
    </div>
  );
}
