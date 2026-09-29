import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { validateADDate, todayIso, ymdOf, monthNames } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange, fiscalYearDefaultAsOf, isFiscalYearOpen } from "@/lib/fiscal";
import { ReportFilter } from "@/components/calendar/report-filter";
import { D } from "@/components/calendar/date-text";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { RowCardList, RowCard, RowMeta, RowValue } from "@/components/ui/row-card";
import {
  dashboardKpis,
  cashAndBankBreakdown,
  revenueExpenseTrend,
  expenseBreakdown,
  needsAttention,
  receivableAgeingSummary,
  complianceSummary,
  upcomingComplianceDeadlines,
} from "@/lib/dashboard/aggregates";
import { RevenueExpenseChart } from "./revenue-expense-chart";
import { ExpenseTracker } from "./expense-tracker";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const currency = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n === null ? null : `${n >= 0 ? "↑" : "↓"} ${Math.abs(n).toFixed(1)}%`);
const rangeQs = (from: string, to: string) => new URLSearchParams({ from, to }).toString();

const linkCard = "block rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 transition-shadow hover:shadow-sm";
const drillLink = "text-xs font-medium text-[var(--color-primary)] hover:underline";

// Where each Needs Attention item's own detail lives — the module/report that either created the
// issue (drafts) or is the natural place to resolve or investigate it.
const NEEDS_ATTENTION_HREF: Record<string, string> = {
  trial_balance: "/reports/trial-balance",
  draft_invoices: "/sales",
  draft_bills: "/purchases",
  negative_stock: "/inventory/items",
  overdue_receivables: "/reports/receivable-ageing",
};

const NEEDS_ATTENTION_TONE: Record<"critical" | "action", { tone: StatusTone; label: string }> = {
  critical: { tone: "critical", label: "Critical" },
  action: { tone: "action", label: "Action Required" },
};

const COMPLIANCE_TONE: Record<string, { tone: StatusTone; label: string }> = {
  overdue: { tone: "critical", label: "Overdue" },
  pending: { tone: "pending", label: "Pending" },
  in_progress: { tone: "pending", label: "In Progress" },
  partially_paid: { tone: "action", label: "Partially Paid" },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  const sp = await searchParams;

  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;
  const today = todayIso();
  // "As of" balances/checks track today (or the fiscal year's own end date if today falls
  // outside it — e.g. viewing a closed year), never the selected range's `to`, which for the
  // default "whole fiscal year" range is the year's end date and can be far in the future.
  const asOf = asIso(sp.to) ?? fiscalYearDefaultAsOf(activeFiscalYear);

  const canViewLedger = can(session, "chart_of_accounts", "view");
  const canViewSales = can(session, "sales", "view");
  const canViewCompliance = can(session, "compliance", "view");

  const [kpis, cashAndBank, trend, expenses, attention, ageing, compliance, deadlines] = await Promise.all([
    canViewLedger ? dashboardKpis(session.tenantId, { from, to }) : Promise.resolve(null),
    canViewLedger ? cashAndBankBreakdown(session.tenantId, asOf) : Promise.resolve(null),
    canViewLedger ? revenueExpenseTrend(session.tenantId, 7, asOf) : Promise.resolve(null),
    canViewLedger ? expenseBreakdown(session.tenantId, { from, to }) : Promise.resolve(null),
    canViewLedger ? needsAttention(session.tenantId, asOf) : Promise.resolve(null),
    canViewSales ? receivableAgeingSummary(session.tenantId, asOf) : Promise.resolve(null),
    canViewCompliance ? complianceSummary(session.tenantId, today) : Promise.resolve(null),
    canViewCompliance ? upcomingComplianceDeadlines(session.tenantId, today) : Promise.resolve(null),
  ]);

  const monthLabel = (iso: string) => {
    const ymd = ymdOf(session.calendar, iso);
    return ymd ? monthNames(session.calendar)[ymd.month - 1].slice(0, 3) : iso.slice(5, 7);
  };
  const trendData = trend?.map((p) => ({ label: monthLabel(p.monthEnd), revenue: p.revenue, expenses: p.expenses })) ?? [];
  const ageingMax = ageing ? Math.max(...ageing.buckets.map((b) => b.amount), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            <D value={from} /> – <D value={to} />
          </p>
        </div>
        {"code" in activeFiscalYear ? (
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            FY {activeFiscalYear.code}
            <StatusPill tone={isFiscalYearOpen(activeFiscalYear) ? "success" : "pending"}>
              {activeFiscalYear.status === "open" ? "Open" : activeFiscalYear.status === "reopened" ? "Reopened" : "Closed"}
            </StatusPill>
          </p>
        ) : (
          <StatusPill tone="pending">All Time</StatusPill>
        )}
      </div>

      <ReportFilter from={from} to={to} fiscal={fiscal} />

      {kpis && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Link href={`/reports/profit-and-loss?${rangeQs(from, to)}`} className={linkCard}>
            <p className="text-sm text-[var(--text-secondary)]">Revenue</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{currency(kpis.revenue)}</p>
            {pct(kpis.revenueTrendPct) && <p className="mt-1 text-xs font-medium text-green-600">{pct(kpis.revenueTrendPct)} vs prior period</p>}
          </Link>
          <Link href={`/reports/profit-and-loss?${rangeQs(from, to)}`} className={linkCard}>
            <p className="text-sm text-[var(--text-secondary)]">Expenses</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{currency(kpis.expenses)}</p>
            {pct(kpis.expenseTrendPct) && <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{pct(kpis.expenseTrendPct)} vs prior period</p>}
          </Link>
          <Link href={`/reports/profit-and-loss?${rangeQs(from, to)}`} className={linkCard}>
            <p className="text-sm text-[var(--text-secondary)]">Net Profit</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{currency(kpis.netProfit)}</p>
            {pct(kpis.netProfitTrendPct) && <p className="mt-1 text-xs font-medium text-green-600">{pct(kpis.netProfitTrendPct)} vs prior period</p>}
          </Link>

          {cashAndBank && (
            <Link href={`/reports/cash-bank-movement?${rangeQs(from, to)}`} className={`${linkCard} sm:col-span-3 lg:col-span-1`}>
              <p className="text-sm text-[var(--text-secondary)]">Cash &amp; Bank Balance</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{currency(cashAndBank.total)}</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {cashAndBank.accounts.map((a) => (
                  <div key={a.accountId} className="flex items-center justify-between border-t border-[var(--card-border)] pt-1.5 text-xs">
                    <span className="text-[var(--text-secondary)]">{a.name}</span>
                    <span className="font-semibold text-[var(--text-primary)]">{currency(a.balance)}</span>
                  </div>
                ))}
              </div>
            </Link>
          )}
        </div>
      )}

      {(trendData.length > 0 || expenses) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          {trendData.length > 0 && (
            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Revenue vs Expenses</h2>
                <Link href={`/reports/profit-and-loss?${rangeQs(from, to)}`} className={drillLink}>
                  View P&amp;L →
                </Link>
              </div>
              <RevenueExpenseChart data={trendData} />
            </div>
          )}
          {expenses && (
            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <ExpenseTracker categories={expenses.categories} otherAmount={expenses.otherAmount} total={expenses.total} reportHref={`/reports/profit-and-loss?${rangeQs(from, to)}`} />
            </div>
          )}
        </div>
      )}

      {attention && attention.length > 0 && (
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
          <h2 className="mb-3 text-sm font-bold text-[var(--text-primary)]">Needs Attention</h2>
          <RowCardList>
            {attention.map((item) => {
              const { tone, label } = NEEDS_ATTENTION_TONE[item.severity];
              const href = NEEDS_ATTENTION_HREF[item.id];
              const title = href ? (
                <Link href={href} className="hover:underline hover:text-[var(--color-primary)]">
                  {item.label}
                </Link>
              ) : (
                item.label
              );
              return (
                <RowCard key={item.id}>
                  <RowMeta title={title} subtitle={item.detail} />
                  <RowValue primary={item.amount !== undefined ? currency(item.amount) : item.count !== undefined ? `${item.count} items` : ""}>
                    <StatusPill tone={tone}>{label}</StatusPill>
                  </RowValue>
                </RowCard>
              );
            })}
          </RowCardList>
        </div>
      )}

      {(ageing || deadlines) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ageing && (
            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Receivable Ageing</h2>
                <Link href={`/reports/receivable-ageing?to=${asOf}`} className={drillLink}>
                  View report →
                </Link>
              </div>
              <div className="flex flex-col gap-3">
                {ageing.buckets.map((b) => (
                  <div key={b.label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{b.label}</span>
                      <span className="font-semibold text-[var(--text-primary)]">{currency(b.amount)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted-bg)]">
                      <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.max((b.amount / ageingMax) * 100, 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {deadlines && (
            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Compliance Deadlines</h2>
                <div className="flex items-center gap-2">
                  {compliance && compliance.overdue > 0 && <StatusPill tone="critical">{compliance.overdue} overdue</StatusPill>}
                  <Link href="/compliance" className={drillLink}>
                    View all →
                  </Link>
                </div>
              </div>
              {deadlines.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">Nothing due soon.</p>
              ) : (
                <RowCardList>
                  {deadlines.map((d) => {
                    const { tone, label } = COMPLIANCE_TONE[d.status] ?? { tone: "pending" as StatusTone, label: d.status };
                    return (
                      <RowCard key={d.id}>
                        <RowMeta
                          title={
                            <Link href="/compliance" className="hover:underline hover:text-[var(--color-primary)]">
                              {d.name}
                            </Link>
                          }
                          subtitle={<D value={d.dueDate} style="short" />}
                        />
                        <StatusPill tone={tone}>{label}</StatusPill>
                      </RowCard>
                    );
                  })}
                </RowCardList>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
