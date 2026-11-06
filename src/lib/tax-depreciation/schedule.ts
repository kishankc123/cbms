import type { PoolPreview } from "./year";

// The tax depreciation schedule laid out as a table. Pure: no database, so the screen, the download and the tests all use the same figures.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ScheduleRow = { key: string; label: string; cells: (number | null)[]; total: number | null; kind: "amount" | "rate" };
export type Schedule = { columns: { key: string; label: string }[]; rows: ScheduleRow[] };

const LINES: { key: string; label: string; of: (p: PoolPreview) => number; kind?: "rate" }[] = [
  { key: "opening", label: "Balance brought forward", of: (p) => p.result.openingWdv },
  { key: "additions", label: "Additions counted this year", of: (p) => p.result.currentYearAdditions },
  { key: "deferredNew", label: "Deferred to next year", of: (p) => p.result.deferredAdditions },
  { key: "priorDeferred", label: "Deferred additions received from earlier years", of: (p) => p.result.priorDeferredReceived },
  { key: "statutory", label: "Statutory additions", of: (p) => p.result.statutoryAdditions },
  { key: "proceeds", label: "Disposal proceeds", of: (p) => p.result.disposalProceeds },
  { key: "base", label: "Base for depreciation", of: (p) => p.result.depreciationBase },
  { key: "rate", label: "Rate (%)", of: (p) => p.result.ratePercent, kind: "rate" },
  { key: "normal", label: "Normal depreciation", of: (p) => p.result.normalDepreciation },
  { key: "additional", label: "Small-balance write-off", of: (p) => p.result.additionalDepreciation },
  { key: "sameYear", label: "Same-year concession deductions", of: (p) => p.result.sameYearDeductions },
  { key: "terminal", label: "Terminal deduction", of: (p) => p.result.terminalDeduction },
  { key: "total", label: "Total deduction", of: (p) => p.result.totalDeduction },
  { key: "balancing", label: "Balancing charge (taxable income)", of: (p) => p.result.balancingCharge },
  { key: "closing", label: "Closing balance", of: (p) => p.result.closingWdv },
];

/** The year laid out as a schedule: a column per class, a row per line, and a total. Rows that are zero everywhere are kept so the layout never moves. */
export function buildSchedule(pools: PoolPreview[]): Schedule {
  return {
    columns: pools.map((p) => ({ key: `${p.key}-${p.assetId ?? ""}`, label: p.label })),
    rows: LINES.map((l) => ({ key: l.key, label: l.label, kind: l.kind === "rate" ? "rate" : "amount", cells: pools.map((p) => l.of(p)), total: l.kind === "rate" ? null : round2(pools.reduce((s, p) => s + l.of(p), 0)) })),
  };
}

const csvCell = (v: string | number | null) => (v === null ? "" : typeof v === "number" ? v.toFixed(2) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The schedule as comma-separated text for a spreadsheet. */
export function scheduleCsv(s: Schedule): string {
  const head = ["", ...s.columns.map((c) => c.label), "Total"];
  const lines = s.rows.map((r) => [r.label, ...r.cells, r.total]);
  return [head, ...lines].map((row) => row.map(csvCell).join(",")).join("\n");
}
