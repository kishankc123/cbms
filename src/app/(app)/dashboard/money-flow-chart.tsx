"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type FlowPoint = { label: string; moneyIn: number; moneyOut: number };

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function FlowTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const inn = payload.find((p) => p.name === "Money in")?.value ?? 0;
  const out = payload.find((p) => p.name === "Money out")?.value ?? 0;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-popover)]">
      <p className="mb-1 font-medium text-ink">{label}</p>
      <p className="text-accent-text">Money in: {fmt(inn)}</p>
      <p className="text-[var(--danger-text)]">Money out: {fmt(out)}</p>
      <p className="mt-1 border-t border-line pt-1 text-ink-2">Net: {fmt(inn - out)}</p>
    </div>
  );
}

// Money in and money out for each day, week or month, side by side. Actual cash only.
export function MoneyFlowChart({ data, height = 220 }: { data: FlowPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%" barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <Tooltip content={<FlowTooltip />} cursor={{ fill: "var(--bg-hover)" }} />
        <Bar dataKey="moneyIn" name="Money in" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={22} />
        <Bar dataKey="moneyOut" name="Money out" fill="var(--danger)" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
