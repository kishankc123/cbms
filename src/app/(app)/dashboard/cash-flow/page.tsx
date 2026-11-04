import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { requireTenantSession, requireUserSession } from "@/lib/session";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill } from "@/components/ui/status-pill";
import { Amount, DataTable, Td, Th, Tr } from "@/components/ui/data-table";
import { cashFlow, defaultGrain, type Grain } from "@/lib/dashboard/cash-flow";
import { DashboardHeader } from "../dashboard-header";
import { GrainSwitch, MoneyFlowSection, OutflowBreakdown, money } from "../cash-sections";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const isGrain = (v: string | string[] | undefined): v is Grain => v === "day" || v === "week" || v === "month";

export default async function CashFlowTab({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardView("chart_of_accounts");
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
  const grain: Grain = isGrain(sp.grain) ? sp.grain : defaultGrain(from, to);
  const flow = await cashFlow(session.tenantId, from, to);
  const hrefFor = (g: Grain) => `/dashboard/cash-flow?${new URLSearchParams({ from, to, grain: g }).toString()}`;
  const matches = Math.abs(flow.difference) < 0.005;

  return (
    <div className="space-y-5">
      <DashboardHeader name={user.name ?? ""} activeFiscalYear={activeFiscalYear} from={from} to={to} fiscal={fiscal} />

      <StatStrip
        items={[
          { label: "Cash at start", value: money(flow.openingCash) },
          { label: "Money in", value: money(flow.moneyIn) },
          { label: "Money out", value: money(flow.moneyOut) },
          { label: "Net movement", value: money(flow.netMovement), tone: flow.netMovement < 0 ? "warning" : "default" },
          { label: "Cash at end", value: money(flow.closingCash), tone: flow.closingCash < 0 ? "danger" : "default" },
        ]}
      />
      <p className="-mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <StatusPill tone={matches ? "success" : "critical"}>{matches ? "Matches the ledger" : `Differs from the ledger by ${money(flow.difference)}`}</StatusPill>
        Cash at start + net movement{flow.transfersNet !== 0 ? " + transfers" : ""}
        {flow.openingEntriesNet !== 0 ? " + opening balances entered" : ""} = cash at end. All figures are actual cash and bank movements, not forecasts.
      </p>

      <MoneyFlowSection flow={flow} grain={grain} calendar={session.calendar} height={260} action={<GrainSwitch grain={grain} hrefFor={hrefFor} />} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">By activity</h2>
          <DataTable>
            <thead>
              <Tr className="hover:bg-transparent">
                <Th>Category</Th>
                <Th align="right">Money in</Th>
                <Th align="right">Money out</Th>
              </Tr>
            </thead>
            <tbody>
              {flow.activities.length === 0 && (
                <Tr>
                  <Td colSpan={3} className="py-6 text-center text-ink-2">
                    No money moved in this period.
                  </Td>
                </Tr>
              )}
              {flow.activities.flatMap((a) => [
                <Tr key={a.activity} className="bg-surface-2 font-medium hover:bg-surface-2">
                  <Td>{a.label}</Td>
                  <Td numeric>
                    <Amount value={a.moneyIn} />
                  </Td>
                  <Td numeric>
                    <Amount value={a.moneyOut} />
                  </Td>
                </Tr>,
                ...flow.categories
                  .filter((c) => c.activity === a.activity)
                  .map((c) => (
                    <Tr key={c.key}>
                      <Td className="pl-6 text-ink-2">{c.label}</Td>
                      <Td numeric>{c.side === "in" ? <Amount value={c.amount} /> : ""}</Td>
                      <Td numeric>{c.side === "out" ? <Amount value={c.amount} /> : ""}</Td>
                    </Tr>
                  )),
              ])}
              {flow.activities.length > 0 && (
                <Tr className="font-semibold hover:bg-transparent">
                  <Td>Total</Td>
                  <Td numeric>
                    <Amount value={flow.moneyIn} />
                  </Td>
                  <Td numeric>
                    <Amount value={flow.moneyOut} />
                  </Td>
                </Tr>
              )}
            </tbody>
          </DataTable>
        </section>
        <OutflowBreakdown flow={flow} limit={8} />
      </div>

      <details className="text-xs text-ink-2">
        <summary className="cursor-pointer select-none hover:text-ink">How these figures are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Every line posted to a cash, bank or wallet account in the period, grouped by what created it and, for payments, by the payment type.</li>
          <li>A sale or bill that is still unpaid is not money in or out. It counts on the day the money moves.</li>
          <li>Moves between your own cash and bank accounts, and the opening balances entered when the books were started, are not money in or out. They are shown in the check above.</li>
          <li>A payment voided or edited in the same period cancels out and does not show. One voided in a later period shows as a reduction in its category that day.</li>
          <li>Rent and other expenses are shown together as expenses paid. Payroll appears when salaries are paid, not when the salary sheet is finalised.</li>
          <li>Weeks run Sunday to Saturday. Months follow your calendar.</li>
        </ul>
        <p className="mt-2">
          The indirect Cash Flow Statement, which starts from profit, is in{" "}
          <Link href="/reports" className="text-accent-text hover:underline">
            Reports
          </Link>
          .
        </p>
      </details>
    </div>
  );
}
