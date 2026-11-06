import { describe, expect, it } from "vitest";
import { computePool } from "./engine";
import { buildSchedule, scheduleCsv } from "./schedule";
import { NEPAL_TAX_DEPRECIATION_RULES as rules } from "./rules";
import type { PoolPreview } from "./year";

const rule = (k: string) => rules.pools.find((p) => p.key === k)!;
const base = { rules, priorDeferred: [], statutory: [], disposals: [], dissolved: false };
const pools: PoolPreview[] = [
  { key: "B", assetId: null, label: "Class B", deferredIds: [], disposedAssetIds: [], result: computePool({ ...base, pool: rule("B"), openingWdv: 100000, additions: [{ id: "a", label: "PC", cost: 60000, date: "2026-03-01" }] }) },
  { key: "A", assetId: null, label: "Class A", deferredIds: [], disposedAssetIds: [], result: computePool({ ...base, pool: rule("A"), openingWdv: 50000, additions: [], disposals: [{ assetId: "x", proceeds: 80000, date: "2026-04-01" }] }) },
];

describe("the tax depreciation schedule", () => {
  const s = buildSchedule(pools);
  const row = (k: string) => s.rows.find((r) => r.key === k)!;
  it("has a column per class and a row per line, with totals that add up", () => {
    expect(s.columns.map((c) => c.label)).toEqual(["Class B", "Class A"]);
    expect(row("opening")).toMatchObject({ cells: [100000, 50000], total: 150000 });
    expect(row("additions").cells).toEqual([40000, 0]);
    expect(row("deferredNew").total).toBe(20000);
    expect(row("normal").cells).toEqual([35000, 0]);
    expect(row("balancing")).toMatchObject({ cells: [0, 30000], total: 30000 });
    expect(row("closing")).toMatchObject({ cells: [105000, 0], total: 105000 });
  });
  it("never adds up rates", () => {
    expect(row("rate")).toMatchObject({ cells: [25, 5], total: null, kind: "rate" });
  });
  it("makes a spreadsheet file with every class and a total", () => {
    const lines = scheduleCsv(s).split("\n");
    expect(lines[0]).toBe("Class B,Class A,Total".replace(/^/, ","));
    expect(lines.find((l) => l.startsWith("Balance brought forward"))).toBe("Balance brought forward,100000.00,50000.00,150000.00");
    expect(lines.find((l) => l.startsWith("Rate"))).toBe("Rate (%),25.00,5.00,");
  });
});
