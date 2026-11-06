import Link from "next/link";
import { requireTenantSession, requireUserSession, can } from "@/lib/session";
import { validateADDate, todayIso } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange, fiscalYearDefaultAsOf } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { needsAttention, complianceSummary, upcomingComplianceDeadlines } from "@/lib/dashboard/aggregates";
import { loadPerformance } from "@/lib/dashboard/performance";
import { DashboardHeader } from "./dashboard-header";
import { PerformanceSection } from "./performance-section";
import { money } from "./cash-sections";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const rangeQs = (from: string, to: string) => new URLSearchParams({ from, to }).toString();

// Where each Needs Attention item's own detail lives — the module/report that either created the
// issue (drafts) or is the natural place to resolve or investigate it.
const NEEDS_ATTENTION_HREF: Record<string, string> = {
  trial_balance: "/reports/trial-balance",
  draft_invoices: "/sales",
  draft_bills: "/purchases",
  details_pending: "/purchases/stockable",
  negative_stock: "/inventory/items",
  overdue_receivables: "/reports/receivable-ageing",
  cheques_due: "/payments/cheques",
  received_cheques_ready: "/payments/cheques-received",
};

const NEEDS_ATTENTION_TONE: Record<"critical" | "action", { tone: StatusTone; label: string }> = {
  critical: { tone: "critical", label: "Critical" },
  action: { tone: "action", label: "Action required" },
};

const COMPLIANCE_TONE: Record<string, { tone: StatusTone; label: string }> = {
  overdue: { tone: "critical", label: "Overdue" },
  pending: { tone: "pending", label: "Pending" },
  in_progress: { tone: "pending", label: "In progress" },
  partially_paid: { tone: "action", label: "Partially paid" },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  // "As of" balances track today (or the fiscal year's own end date if today falls outside it, as in a closed year), never the selected
  // range's `to`, which for the default "whole fiscal year" range can be far in the future.
  const asOf = asIso(sp.to) ?? fiscalYearDefaultAsOf(activeFiscalYear);

  const canViewLedger = can(session, "chart_of_accounts", "view");
  const canViewCompliance = can(session, "compliance", "view");

  // Revenue, cost of goods sold, expenses and profit with their comparisons and expectation. (Cash has its own tabs: Cash flow, Forecast and Planning.)
  const [perf, attention, compliance, deadlines] = await Promise.all([
    canViewLedger ? loadPerformance(session.tenantId, { from, to }, session.calendar, today) : Promise.resolve(null),
    canViewLedger ? needsAttention(session.tenantId, asOf) : Promise.resolve(null),
    canViewCompliance ? complianceSummary(session.tenantId, today) : Promise.resolve(null),
    canViewCompliance ? upcomingComplianceDeadlines(session.tenantId, today) : Promise.resolve(null),
  ]);
  const qs = rangeQs(from, to);

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} from={from} to={to} fiscal={fiscal} />

      {perf && <PerformanceSection perf={perf} qs={qs} />}

      {((attention && attention.length > 0) || deadlines) && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {attention && attention.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">Needs attention</h2>
              <ul className="divide-y divide-[var(--border)] border-y border-line">
                {attention.map((item) => {
                  const { tone, label } = NEEDS_ATTENTION_TONE[item.severity];
                  const href = NEEDS_ATTENTION_HREF[item.id];
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-ink">{href ? <Link href={href} className="hover:underline">{item.label}</Link> : item.label}</p>
                        <p className="truncate text-xs text-ink-2">{item.detail}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tnum text-[13px] font-medium text-ink">{item.amount !== undefined ? money(item.amount) : item.count !== undefined ? `${item.count} items` : ""}</span>
                        <StatusPill tone={tone}>{label}</StatusPill>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {deadlines && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Compliance deadlines</h2>
                <div className="flex items-center gap-2">
                  {compliance && compliance.overdue > 0 && <StatusPill tone="critical">{compliance.overdue} overdue</StatusPill>}
                  <Link href="/compliance" className="text-xs font-medium text-accent-text hover:underline">
                    View all →
                  </Link>
                </div>
              </div>
              {deadlines.length === 0 ? (
                <p className="text-[13px] text-ink-2">Nothing due soon.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)] border-y border-line">
                  {deadlines.map((d) => {
                    const { tone, label } = COMPLIANCE_TONE[d.status] ?? { tone: "pending" as StatusTone, label: d.status };
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <Link href="/compliance" className="truncate text-[13px] text-ink hover:underline">
                            {d.name}
                          </Link>
                          <p className="text-xs text-ink-2">
                            <D value={d.dueDate} style="short" />
                          </p>
                        </div>
                        <StatusPill tone={tone}>{label}</StatusPill>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
