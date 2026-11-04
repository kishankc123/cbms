import Link from "next/link";
import { CATEGORIES, toBuckets, type CashFlowResult, type Grain } from "@/lib/dashboard/cash-flow-rules";
import type { CalendarSystem } from "@/lib/calendar";
import { LazyMoneyFlowChart } from "./money-flow-chart-lazy";

export const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const GRAINS: { key: Grain; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

/** Daily, weekly or monthly: three links that keep the rest of the address (the period) as it is. */
export function GrainSwitch({ grain, hrefFor }: { grain: Grain; hrefFor: (g: Grain) => string }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface-2 p-0.5 text-xs" role="group" aria-label="Group by">
      {GRAINS.map((g) => (
        <Link key={g.key} href={hrefFor(g.key)} aria-current={g.key === grain ? "true" : undefined} className={`rounded px-2.5 py-1 transition-colors ${g.key === grain ? "bg-surface font-medium text-ink shadow-[var(--shadow-sm)]" : "text-ink-2 hover:text-ink"}`}>
          {g.label}
        </Link>
      ))}
    </div>
  );
}

/** The chart: money in beside money out for each day, week or month of the period. Actual cash only. */
export function MoneyFlowSection({ flow, grain, calendar, height, action }: { flow: CashFlowResult; grain: Grain; calendar: CalendarSystem; height?: number; action?: React.ReactNode }) {
  const data = toBuckets(flow.daily, { from: flow.from, to: flow.to }, grain, calendar).map((b) => ({ label: b.label, moneyIn: b.moneyIn, moneyOut: b.moneyOut }));
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Money in vs money out</h2>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-3 text-xs text-ink-2">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-accent" /> In
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[var(--danger)]" /> Out
            </span>
          </span>
          {action}
        </div>
      </div>
      <LazyMoneyFlowChart data={data} height={height} />
      <p className="mt-1 text-xs text-ink-2">Actual cash and bank movements. Invoices and bills are counted only when the money moves.</p>
    </section>
  );
}

/** Where the money went, biggest first. */
export function OutflowBreakdown({ flow, limit = 6, moreHref }: { flow: CashFlowResult; limit?: number; moreHref?: string }) {
  const rows = flow.categories.filter((c) => c.side === "out").sort((a, b) => b.amount - a.amount);
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((s, c) => s + c.amount, 0);
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Cash outflow breakdown</h2>
        {moreHref && (
          <Link href={moreHref} className="text-xs font-medium text-accent-text hover:underline">
            See all →
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-2">No money went out in this period.</p>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((r) => (
            <li key={r.key}>
              <div className="mb-1 flex justify-between gap-2 text-xs">
                <span className="truncate text-ink">{r.label}</span>
                <span className="tnum shrink-0 font-medium text-ink">{money(r.amount)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max((r.amount / max) * 100, 2)}%` }} />
              </div>
            </li>
          ))}
          {rest > 0 && (
            <li className="flex justify-between text-xs text-ink-2">
              <span>Other categories</span>
              <span className="tnum">{money(rest)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export const CATEGORY_ORDER = CATEGORIES.map((c) => c.key);
