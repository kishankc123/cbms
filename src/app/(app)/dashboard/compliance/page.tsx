import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { requireTenantSession, requireUserSession } from "@/lib/session";
import { validateADDate, todayIso } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { ObligationStatusPill } from "@/components/compliance/status-pill";
import { loadComplianceTab, type RegistrationView } from "@/lib/dashboard/compliance-tab";
import { ComplianceProfileNotice } from "../../compliance/profile-notice";
import { ExcisePermitAlert } from "../../compliance/excise-permit-alert";
import { CatchupPrompt } from "../../compliance/catchup-prompt";
import { DashboardHeader } from "../dashboard-header";
import { money } from "../cash-sections";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

const REG_PILL: Record<RegistrationView["state"], { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  inactive: { tone: "neutral", label: "Inactive" },
  suspended: { tone: "critical", label: "Suspended" },
  deregistered: { tone: "neutral", label: "Deregistered" },
  renewal_due: { tone: "action", label: "Renewal due" },
  expired: { tone: "critical", label: "Expired" },
};

// The Compliance tab of the dashboard: what is overdue and coming up, the registrations, and the set-up notices. What is open now ignores the
// period at the top; only "Filed in this period" and fines follow it. The detail pages (Calendar, Tax, Statutory ...) stay in the Compliance menu.
export default async function ComplianceTab({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const session = await requireTenantSession();
  const user = await requireUserSession();
  const sp = await searchParams;

  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  const today = todayIso();

  const data = await loadComplianceTab(session.tenantId, today, { from, to });

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} from={from} to={to} fiscal={fiscal} />

      <div className="space-y-2 empty:hidden">
        <ComplianceProfileNotice />
        <ExcisePermitAlert />
        <CatchupPrompt />
      </div>

      <StatStrip
        items={[
          { label: "Overdue", value: data.counts.overdue, tone: data.counts.overdue > 0 ? "danger" : "default" },
          { label: "Due in 7 days", value: data.counts.dueSoon, tone: data.counts.dueSoon > 0 ? "warning" : "default" },
          { label: "Coming in 30 days", value: data.counts.coming },
          { label: "Filed in this period", value: data.counts.filedInPeriod },
        ]}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Deadlines</h2>
            <Link href="/compliance/calendar" className="text-xs font-medium text-accent-text hover:underline">
              Open calendar →
            </Link>
          </div>
          {data.deadlines.length === 0 ? (
            <p className="border-y border-line py-4 text-[13px] text-ink-2">
              {data.hasAnything ? "Nothing is overdue or due in the next 30 days." : "Requirements appear here once your company details and tax registrations are set."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">Requirement</th>
                    <th className="px-2.5 py-1.5 font-medium">Due</th>
                    <th className="px-2.5 py-1.5 text-right font-medium">Amount</th>
                    <th className="px-2.5 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deadlines.map((d) => (
                    <tr key={d.id} className="border-b border-line transition-colors hover:bg-hover">
                      <td className="px-2.5 py-1.5">
                        <Link href={d.href} className="text-ink hover:underline">
                          {d.name}
                        </Link>
                        <p className="text-xs text-ink-2">
                          {d.period} · {d.area === "tax" ? "Tax" : "Statutory"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        <D value={d.dueDate} style="short" />
                      </td>
                      <td className="tnum px-2.5 py-1.5 text-right">{d.amount === null ? <span className="text-ink-3">–</span> : money(d.amount)}</td>
                      <td className="px-2.5 py-1.5">
                        <ObligationStatusPill status={d.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.moreCount > 0 && (
                <p className="mt-1.5 text-xs text-ink-2">
                  {data.moreCount} more.{" "}
                  <Link href="/compliance/calendar" className="text-accent-text hover:underline">
                    See them in the calendar
                  </Link>
                </p>
              )}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">By area</h2>
            <ul className="divide-y divide-[var(--border)] border-y border-line">
              {data.areas.map((a) => (
                <li key={a.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <Link href={a.href} className="text-ink hover:underline">
                    {a.label}
                  </Link>
                  <span className="text-xs text-ink-2">
                    {a.pending} open{a.overdue > 0 && <span className="text-[var(--danger-text)]"> · {a.overdue} overdue</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Registrations</h2>
              <Link href="/compliance/registrations" className="text-xs font-medium text-accent-text hover:underline">
                Manage →
              </Link>
            </div>
            {data.registrations.length === 0 ? (
              <p className="text-[13px] text-ink-2">No registrations are recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] border-y border-line">
                {data.registrations.map((r) => {
                  const pill = REG_PILL[r.state];
                  return (
                    <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                      <span className="min-w-0 truncate text-ink">
                        {r.name}
                        {r.number && <span className="ml-1.5 text-xs text-ink-2">{r.number}</span>}
                      </span>
                      <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <ul className="divide-y divide-[var(--border)] border-y border-line text-[13px]">
              <li className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink">Open exceptions</span>
                {data.openExceptions > 0 ? (
                  <Link href="/audit/exceptions" className="text-xs font-medium text-accent-text hover:underline">
                    {data.openExceptions} · Exception Centre →
                  </Link>
                ) : (
                  <span className="text-xs text-ink-2">None</span>
                )}
              </li>
              <li className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink">Fines and interest in this period</span>
                <span className="tnum text-xs text-ink-2">{data.finesInPeriod > 0 ? money(data.finesInPeriod) : "None"}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
