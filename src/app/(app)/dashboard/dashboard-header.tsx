import Link from "next/link";
import { greetingFor } from "@/lib/greeting";
import { isFiscalYearOpen, type getActiveFiscalYear } from "@/lib/fiscal";
import { StatusPill } from "@/components/ui/status-pill";
import type { DateRange } from "@/lib/calendar";
import { DashboardTabs } from "./dashboard-tabs";
import { DashboardPeriod } from "./dashboard-period";

// The top of every dashboard tab: the greeting, which financial year is open, and the tabs.
export function DashboardHeader({ name, activeFiscalYear, from, to, fiscal }: { name: string; activeFiscalYear: Awaited<ReturnType<typeof getActiveFiscalYear>>; from?: string; to?: string; fiscal?: DateRange | null }) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">
          {greetingFor(new Date())}, {name}
        </h1>
        {"allTime" in activeFiscalYear ? (
          <StatusPill tone="pending">All Time</StatusPill>
        ) : "suggested" in activeFiscalYear ? (
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            FY {activeFiscalYear.code}
            <StatusPill tone="action">Not yet added</StatusPill>
            <Link href="/settings/fiscal-years" className="text-xs text-accent-text hover:underline">
              Add it →
            </Link>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            FY {activeFiscalYear.code}
            <StatusPill tone={isFiscalYearOpen(activeFiscalYear) ? "success" : "pending"}>{activeFiscalYear.status === "open" ? "Open" : activeFiscalYear.status === "reopened" ? "Reopened" : "Closed"}</StatusPill>
          </p>
        )}
      </div>
      <div className="mb-4 flex flex-col gap-2 border-b border-line sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <DashboardTabs />
        {from && to && (
          <div className="order-first sm:order-none sm:pb-1">
            <DashboardPeriod from={from} to={to} fiscal={fiscal ?? null} />
          </div>
        )}
      </div>
    </>
  );
}
