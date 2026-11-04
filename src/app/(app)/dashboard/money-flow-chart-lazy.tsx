"use client";

import dynamic from "next/dynamic";
import type { FlowPoint } from "./money-flow-chart";

// recharts is the heaviest client dependency, so it loads after the first paint, with a placeholder of the same height so nothing shifts.
const Chart = dynamic(() => import("./money-flow-chart").then((m) => m.MoneyFlowChart), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-md bg-line" />,
});

export function LazyMoneyFlowChart({ data, height = 220 }: { data: FlowPoint[]; height?: number }) {
  if (data.every((p) => p.moneyIn === 0 && p.moneyOut === 0)) {
    return <p className="flex items-center justify-center text-[13px] text-ink-2" style={{ height }}>No money moved in this period.</p>;
  }
  return <Chart data={data} height={height} />;
}
