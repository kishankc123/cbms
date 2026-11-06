"use client";

import dynamic from "next/dynamic";
import type { PerformancePoint } from "./performance-chart";

// recharts loads after the first paint, with a placeholder of the same height so nothing shifts.
const Chart = dynamic(() => import("./performance-chart").then((m) => m.PerformanceChart), {
  ssr: false,
  loading: () => <div className="h-[240px] animate-pulse rounded-md bg-line" />,
});

export function LazyPerformanceChart({ data, height = 240 }: { data: PerformancePoint[]; height?: number }) {
  if (data.every((p) => p.revenue === 0 && p.costs === 0)) {
    return <p className="flex items-center justify-center text-[13px] text-ink-2" style={{ height }}>Nothing has been posted in these months yet.</p>;
  }
  return <Chart data={data} height={height} />;
}
