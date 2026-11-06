"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type PerformancePoint = { label: string; revenue: number; costs: number; profit: number; partial: boolean };

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function PerformanceTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: PerformancePoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-popover)]">
      <p className="mb-1 font-medium text-ink">
        {label}
        {p.partial ? " (month not finished)" : ""}
      </p>
      <p className="text-accent-text">Revenue: {fmt(p.revenue)}</p>
      <p className="text-[var(--warning-text)]">Costs: {fmt(p.costs)}</p>
      <p className="mt-1 border-t border-line pt-1 font-medium text-ink">Profit: {fmt(p.profit)}</p>
    </div>
  );
}

// Revenue and costs for each month side by side, with the month's profit as a line over them. Costs are cost of goods sold plus expenses.
export function PerformanceChart({ data, height = 240 }: { data: PerformancePoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%" barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <Tooltip content={<PerformanceTooltip />} cursor={{ fill: "var(--bg-hover)" }} />
        <Bar dataKey="revenue" name="Revenue" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={20} />
        <Bar dataKey="costs" name="Costs" fill="var(--warning)" fillOpacity={0.8} radius={[3, 3, 0, 0]} maxBarSize={20} />
        <Line type="monotone" dataKey="profit" name="Profit" stroke="var(--text-1)" strokeWidth={2} dot={{ r: 2.5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
