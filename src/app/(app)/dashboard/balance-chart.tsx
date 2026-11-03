"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type BalancePoint = { label: string; balance: number; moneyIn: number; moneyOut: number };

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const axis = (v: number) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

function BalanceTooltip({ active, payload }: { active?: boolean; payload?: { payload: BalancePoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-popover)]">
      <p className="mb-1 font-medium text-ink">{p.label}</p>
      <p className="text-ink">Expected balance: {fmt(p.balance)}</p>
      {p.moneyIn > 0 && <p className="text-accent-text">In that day: {fmt(p.moneyIn)}</p>}
      {p.moneyOut > 0 && <p className="text-[var(--danger-text)]">Out that day: {fmt(p.moneyOut)}</p>}
    </div>
  );
}

// The expected cash balance for each day ahead, with the reserve as a dashed line. Below the reserve is where to take care.
export function BalanceChart({ data, reserve, height = 240 }: { data: BalancePoint[]; reserve: number; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={false} tickLine={false} width={48} tickFormatter={axis} />
        <Tooltip content={<BalanceTooltip />} />
        <ReferenceLine y={0} stroke="var(--danger)" strokeOpacity={0.6} />
        {reserve > 0 && <ReferenceLine y={reserve} stroke="var(--warning-text)" strokeDasharray="5 4" label={{ value: "Reserve", position: "insideTopRight", fontSize: 11, fill: "var(--text-2)" }} />}
        <Area type="stepAfter" dataKey="balance" stroke="var(--accent)" strokeWidth={2} fill="url(#balanceFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
