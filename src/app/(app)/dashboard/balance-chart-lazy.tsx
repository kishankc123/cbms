"use client";

import dynamic from "next/dynamic";
import type { BalancePoint } from "./balance-chart";

// Loads after the first paint, with a placeholder of the same height so nothing shifts.
const Chart = dynamic(() => import("./balance-chart").then((m) => m.BalanceChart), {
  ssr: false,
  loading: () => <div className="h-[240px] animate-pulse rounded-md bg-line" />,
});

export function LazyBalanceChart({ data, reserve, height = 240 }: { data: BalancePoint[]; reserve: number; height?: number }) {
  return <Chart data={data} reserve={reserve} height={height} />;
}
