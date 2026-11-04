import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { requireTenantSession, requireUserSession, can } from "@/lib/session";
import { todayIso, formatDate } from "@/lib/calendar";
import { getActiveFiscalYear } from "@/lib/fiscal";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { Amount, DataTable, Td, Th, Tr } from "@/components/ui/data-table";
import { D } from "@/components/calendar/date-text";
import { HORIZONS, loadForecast, parseHorizon } from "@/lib/dashboard/forecast";
import { DashboardHeader } from "../dashboard-header";
import { money } from "../cash-sections";
import { LazyBalanceChart } from "../balance-chart-lazy";
import { PlanningSettingsForm } from "./settings-form";

export default async function ForecastTab({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("chart_of_accounts");
  if (denied) return denied;
  const session = await requireTenantSession();
  const user = await requireUserSession();
  const sp = await searchParams;

  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const today = todayIso();
  const horizon = parseHorizon(sp.days);
  const r = await loadForecast(session.tenantId, today, horizon);
  const { forecast: f, workingCapital: w, assumptions: a } = r;
  const custom = !(HORIZONS as readonly number[]).includes(horizon);

  const points = f.days.map((d) => ({ label: formatDate(d.date, session.calendar, "short"), balance: d.balance, moneyIn: d.moneyIn, moneyOut: d.moneyOut }));
  const net = f.totalIn - f.totalOut;

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-2">Look ahead</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Look ahead">
          {HORIZONS.map((d) => (
            <Link key={d} href={`/dashboard/forecast?days=${d}`} aria-current={d === horizon ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs transition-colors ${d === horizon ? "border-accent bg-surface-2 font-medium text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink"}`}>
              {d} days
            </Link>
          ))}
        </div>
        <form action="/dashboard/forecast" className="flex items-center gap-1.5">
          <label htmlFor="days" className="text-xs text-ink-2">
            or
          </label>
          <input id="days" name="days" type="number" min={1} max={365} defaultValue={custom ? horizon : undefined} placeholder="days" className="h-7 w-20 rounded-md border border-line-strong bg-surface px-2 text-xs text-ink" />
          <button type="submit" className="h-7 rounded-md border border-line-strong px-2.5 text-xs text-ink hover:bg-hover">
            Go
          </button>
        </form>
        <span className="ml-auto text-xs text-ink-2">
          Until <D value={f.horizonEnd} style="short" />
        </span>
      </div>

      {f.warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {f.warnings.map((x) => (
            <li key={x.level} className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
              <StatusPill tone={x.level === "critical" ? "critical" : "action"}>{x.level === "critical" ? "Cash shortfall" : "Below reserve"}</StatusPill>
              {x.message}, from <D value={x.date} style="short" />. The lowest point is {money(f.lowest.balance)} on <D value={f.lowest.date} style="short" />.
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-ink">
          <StatusPill tone="success">On track</StatusPill>
          Cash stays above the reserve for the next {horizon} days.
        </p>
      )}

      {r.cheques.atRisk.length > 0 && (
        <ul className="space-y-1.5">
          {r.cheques.atRisk.slice(0, 5).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
              <StatusPill tone="critical">May not be covered</StatusPill>
              Cheque {c.chequeNumber} to {c.payee} for {money(c.amount)} can be presented on <D value={c.date} style="short" />, when cash is expected to be {money(c.balance)}.
            </li>
          ))}
          <li className="text-xs text-ink-2">
            <Link href="/payments/cheques" className="text-accent-text hover:underline">
              Open Issued Cheques →
            </Link>
          </li>
        </ul>
      )}

      <StatStrip
        items={[
          { label: "Cash today", value: money(f.openingCash), tone: f.openingCash < 0 ? "danger" : "default" },
          { label: "Expected in", value: money(f.totalIn) },
          { label: "Expected out", value: money(f.totalOut) },
          { label: `Cash on day ${horizon}`, value: money(f.endBalance), tone: f.endBalance < 0 ? "danger" : "default" },
          { label: "Lowest point", value: money(f.lowest.balance), tone: f.lowest.balance < 0 ? "danger" : f.lowest.balance < f.reserve ? "warning" : "default" },
        ]}
      />
      <StatStrip
        className="!border-y-0"
        items={[
          { label: "Reserve to keep", value: money(f.reserve) },
          { label: "Cash available to plan", value: money(f.availableToPlan), tone: f.availableToPlan < 0 ? "danger" : "default" },
          { label: "Net change over the period", value: money(net), tone: net < 0 ? "warning" : "default" },
        ]}
      />
      <p className="-mt-3 text-xs text-ink-2">
        Cash available to plan is the lowest expected balance less the reserve: what can be spent over these {horizon} days without touching the reserve. It is an estimate from invoices, bills and schedules already in the books, not a promise.
      </p>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Expected cash balance</h2>
        <LazyBalanceChart data={points} reserve={f.reserve} />
        <p className="mt-1 text-xs text-ink-2">The dashed line is the reserve. New sales and purchases not yet raised are not included.</p>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">What is expected</h2>
          <DataTable>
            <thead>
              <Tr className="hover:bg-transparent">
                <Th>Source</Th>
                <Th align="right">Items</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </thead>
            <tbody>
              {f.byCategory.length === 0 && (
                <Tr>
                  <Td colSpan={3} className="py-6 text-center text-ink-2">
                    Nothing is expected to move in this period.
                  </Td>
                </Tr>
              )}
              {f.byCategory.map((c) => (
                <Tr key={c.key}>
                  <Td>
                    <span className="mr-2 inline-block w-8 text-xs text-ink-2">{c.side === "in" ? "In" : "Out"}</span>
                    {c.label}
                  </Td>
                  <Td numeric>{c.count}</Td>
                  <Td numeric>
                    <Amount value={c.amount} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          {a.unpricedTaxes > 0 && (
            <p className="mt-1.5 text-xs text-ink-2">
              {a.unpricedTaxes} tax {a.unpricedTaxes === 1 ? "deadline has" : "deadlines have"} no amount yet and {a.unpricedTaxes === 1 ? "is" : "are"} not counted. <Link href="/compliance" className="text-accent-text hover:underline">Open Compliance →</Link>
            </p>
          )}
          <p className="mt-1.5 text-xs text-ink-2">
            Who owes and is owed is on the <Link href="/dashboard/upcoming" className="text-accent-text hover:underline">Upcoming</Link> tab.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Working capital</h2>
          <DataTable>
            <tbody>
              <Tr className="bg-surface-2 font-medium hover:bg-surface-2">
                <Td>What the business holds</Td>
                <Td numeric>
                  <Amount value={w.currentAssets} />
                </Td>
              </Tr>
              <Tr>
                <Td className="pl-6 text-ink-2">Cash and bank</Td>
                <Td numeric>
                  <Amount value={w.cash} />
                </Td>
              </Tr>
              <Tr>
                <Td className="pl-6 text-ink-2">Receivables</Td>
                <Td numeric>
                  <Amount value={w.receivables} />
                </Td>
              </Tr>
              <Tr>
                <Td className="pl-6 text-ink-2">Stock, at cost</Td>
                <Td numeric>
                  <Amount value={w.stock} />
                </Td>
              </Tr>
              <Tr className="bg-surface-2 font-medium hover:bg-surface-2">
                <Td>What is owed in the short term</Td>
                <Td numeric>
                  <Amount value={w.currentLiabilities} />
                </Td>
              </Tr>
              <Tr>
                <Td className="pl-6 text-ink-2">Suppliers and unpaid expenses</Td>
                <Td numeric>
                  <Amount value={w.payables} />
                </Td>
              </Tr>
              <Tr>
                <Td className="pl-6 text-ink-2">Salaries owed</Td>
                <Td numeric>
                  <Amount value={w.salaryPayable} />
                </Td>
              </Tr>
              <Tr>
                <Td className="pl-6 text-ink-2">Taxes owed</Td>
                <Td numeric>
                  <Amount value={w.taxPayable} />
                </Td>
              </Tr>
              <Tr className="font-semibold hover:bg-transparent">
                <Td>Working capital today</Td>
                <Td numeric>
                  <Amount value={w.workingCapital} />
                </Td>
              </Tr>
              <Tr className="font-semibold hover:bg-transparent">
                <Td>Expected on day {horizon}</Td>
                <Td numeric>
                  <Amount value={r.projectedWorkingCapital} />
                </Td>
              </Tr>
            </tbody>
          </DataTable>
          <p className="mt-1.5 text-xs text-ink-2">
            Collecting what customers owe and paying what is owed only move value between the two sides, so they do not change working capital. It falls with pay and recurring costs not yet owed, and before any new sales or purchases. Stock is counted at cost, so it may be more than what could be sold quickly.
          </p>
        </section>
      </div>

      <details className="text-xs text-ink-2">
        <summary className="cursor-pointer select-none hover:text-ink">How this forecast is worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Opening cash is what the cash, bank and wallet accounts hold today.</li>
          <li>Customer invoices: on the due date. A customer with at least 3 settled invoices in the last 6 months is moved by how late or early they usually pay ({a.customersWithHabit} {a.customersWithHabit === 1 ? "customer has" : "customers have"} a pattern now). With no due date, the invoice date plus {a.defaultDays} days ({a.defaultDaysSource === "setting" ? "your setting" : a.defaultDaysSource === "learned" ? "learned from the last 6 months" : "a standard 30 days, until there is history"}).</li>
          <li>Supplier bills and expenses: on their due date, or on the document date when none is set.</li>
          <li>Anything already overdue is assumed to move within {a.overdueDays} days.</li>
          <li>Salaries owed are assumed paid within {a.overdueDays} days. Later months repeat the last finalised month&apos;s pay, a week after the month ends.</li>
          <li>Cheques you have written are counted on the date written on them. The bills they cover are not counted again on their due dates, and a cheque already past its date is counted today.</li>
          <li>Recurring expenses are counted from their schedule until the expense is booked, then as an unpaid expense.</li>
          <li>Taxes use the amount entered on the deadline, or else what the books say is owed to that tax, against its earliest deadline.</li>
          <li>Reserve: {r.reserve.how} Fixed expenses come to about {money(r.reserve.fixedMonthly)} a month.</li>
          <li>No new sales are assumed. Sales targets and planned spending come later.</li>
        </ul>
      </details>

      <details className="text-xs text-ink-2">
        <summary className="cursor-pointer select-none hover:text-ink">Planning settings</summary>
        <div className="mt-3 max-w-3xl">
          <PlanningSettingsForm reserveMonths={r.settings.reserveMonths} reserveOverride={r.settings.reserveOverride} defaultCollectionDays={r.settings.defaultCollectionDays} learnedDays={a.defaultDays} learned={a.defaultDaysSource === "learned"} canEdit={can(session, "settings", "edit")} />
        </div>
      </details>
    </div>
  );
}
