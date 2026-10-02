"use client";

import dynamic from "next/dynamic";
import type { TrendPoint } from "./revenue-expense-chart";

// recharts is the heaviest client dependency; load it after first paint (and skip SSR — the chart is
// measured client-side anyway) so it doesn't block the rest of the dashboard. The placeholder matches
// the chart's 220px height so nothing shifts when it arrives.
const RevenueExpenseChart = dynamic(() => import("./revenue-expense-chart").then((m) => m.RevenueExpenseChart), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-md bg-[var(--surface-muted-bg)]" />,
});

export function LazyRevenueExpenseChart({ data }: { data: TrendPoint[] }) {
  return <RevenueExpenseChart data={data} />;
}
