import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import type { Change, Performance, Projection, Totals } from "@/lib/dashboard/performance";
import { LazyPerformanceChart } from "./performance-chart-lazy";
import { money } from "./cash-sections";

type Kind = "income" | "cost";

// Up or down, worded and coloured by whether it helps: revenue and profit rising is good, costs rising is a warning (amber, not an alarm).
function ChangeLine({ label, change, kind }: { label: string; change: Change; kind: Kind }) {
  const arrow = change.direction === "up" ? "▲" : change.direction === "down" ? "▼" : "▬";
  const tone = change.good === null ? "text-ink-2" : change.good ? "text-[var(--success-text)]" : kind === "cost" ? "text-[var(--warning-text)]" : "text-[var(--danger-text)]";
  const pct = change.pct === null ? (change.direction === "flat" ? "no change" : "new") : `${Math.abs(change.pct).toFixed(1)}%`;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-ink-2">{label}</span>
      <span className="tnum">
        <span className={`font-medium ${tone}`}>
          {change.direction !== "flat" && `${arrow} `}
          {pct}
        </span>
        <span className="ml-2 text-ink-2">{money(change.value)}</span>
      </span>
    </div>
  );
}

function ExpectationLine({ projection, months }: { projection: Projection | null; months: string }) {
  if (!projection) return <p className="text-xs text-ink-2">Next 3 months: not enough history yet (needs six finished months).</p>;
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink-2">Next 3 months ({months})</span>
        <span className="tnum font-medium text-ink">about {money(projection.expected)}</span>
      </div>
      <p className="mt-0.5 text-right text-ink-2">
        likely {money(projection.low)} to {money(projection.high)}, from the last {projection.basis} months
      </p>
    </div>
  );
}

function Card({ title, value, href, tone, children }: { title: string; value: number; href: string; tone?: "danger"; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-2">{title}</h2>
      <p className={`text-2xl font-semibold leading-8 tnum ${tone === "danger" ? "text-[var(--danger-text)]" : "text-ink"}`}>
        <Link href={href} className="hover:underline">
          {money(value)}
        </Link>
      </p>
      <div className="space-y-1.5 border-t border-line pt-2">{children}</div>
    </section>
  );
}

const margin = (part: number, revenue: number) => (Math.abs(revenue) < 0.005 ? null : `${((part / revenue) * 100).toFixed(1)}%`);

/**
 * Revenue, cost of goods sold (when the organization keeps stock), expenses and profit for the chosen period: each with the period before, the
 * same period a year ago and a plain expectation for the next three months, then the last twelve months at a glance.
 */
export function PerformanceSection({ perf, qs }: { perf: Performance; qs: string }) {
  const href = `/reports/profit-and-loss?${qs}`;
  const next = perf.nextMonths.length > 0 ? `${perf.nextMonths[0].label} to ${perf.nextMonths[perf.nextMonths.length - 1].label}` : "";
  const c: Totals = perf.current;
  const cmp = (key: keyof Totals, kind: Kind) => (
    <>
      <ChangeLine label="Previous period" change={perf.changes.previous[key]} kind={kind} />
      <ChangeLine label="Same period last year" change={perf.changes.lastYear[key]} kind={kind} />
    </>
  );
  const chart = perf.series.map((m) => ({ label: m.label, revenue: m.revenue, costs: Math.round((m.cogs + m.expenses) * 100) / 100, profit: m.net, partial: m.partial }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-2">
        <D value={perf.range.from} /> to <D value={perf.range.to} />. Compared with <D value={perf.previous.range.from} /> to <D value={perf.previous.range.to} /> and <D value={perf.lastYear.range.from} /> to <D value={perf.lastYear.range.to} />. From posted entries.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Revenue" value={c.revenue} href={href}>
          {cmp("revenue", "income")}
          <ExpectationLine projection={perf.projection.revenue} months={next} />
        </Card>
        {perf.showCogs && (
          <Card title="Cost of goods sold" value={c.cogs} href={href}>
            {cmp("cogs", "cost")}
            <ExpectationLine projection={perf.projection.cogs} months={next} />
            {perf.stockLossesInCogs && <p className="text-xs text-ink-2">Includes stock written off, as set in Settings.</p>}
          </Card>
        )}
        <Card title="Expenses" value={c.expenses} href={href}>
          {cmp("expenses", "cost")}
          <ExpectationLine projection={perf.projection.expenses} months={next} />
        </Card>
        <Card title={perf.showCogs ? "Profitability" : "Net profit"} value={c.net} href={href} tone={c.net < 0 ? "danger" : undefined}>
          {perf.showCogs && (
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-ink-2">Gross profit (revenue less cost of goods sold)</span>
              <span className="tnum font-medium text-ink">
                {money(c.gross)}
                {margin(c.gross, c.revenue) && <span className="ml-2 font-normal text-ink-2">{margin(c.gross, c.revenue)}</span>}
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-ink-2">Net profit margin</span>
            <span className="tnum font-medium text-ink">{margin(c.net, c.revenue) ?? "—"}</span>
          </div>
          {cmp("net", "income")}
          <ExpectationLine projection={perf.projection.net} months={next} />
        </Card>
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Profit by month</h2>
          <span className="flex items-center gap-3 text-xs text-ink-2">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-accent" /> Revenue
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[var(--warning)]" /> Costs
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-[var(--text-1)]" /> Profit
            </span>
          </span>
        </div>
        <LazyPerformanceChart data={chart} />
        <p className="mt-1 text-xs text-ink-2">The last twelve months, whatever period is chosen above. Costs are cost of goods sold plus expenses.</p>
      </section>
    </div>
  );
}
