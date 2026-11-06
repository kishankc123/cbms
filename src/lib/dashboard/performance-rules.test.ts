import { describe, expect, it } from "vitest";
import { buildPerformance, changeOf, lastYearRange, monthlySeries, previousRange, project, totalsOf, type DayAmounts } from "./performance-rules";

const day = (d: string, revenue: number, cogs = 0, expenses = 0): DayAmounts => ({ day: d, revenue, cogs, expenses });

describe("totals", () => {
  const rows = [day("2026-03-10", 1000, 400, 100), day("2026-03-20", 500, 0, 50), day("2026-04-02", 9999, 9999, 9999)];
  it("adds revenue, cost of goods sold and expenses for a period, with gross and net profit", () => {
    expect(totalsOf(rows, "2026-03-01", "2026-03-31")).toEqual({ revenue: 1500, cogs: 400, expenses: 150, gross: 1100, net: 950 });
  });
  it("is zero for a period with nothing in it", () => {
    expect(totalsOf(rows, "2025-01-01", "2025-01-31")).toEqual({ revenue: 0, cogs: 0, expenses: 0, gross: 0, net: 0 });
  });
});

describe("comparison periods", () => {
  it("the previous period is the same length ending the day before", () => {
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ from: "2026-01-29", to: "2026-02-28" });
    expect(previousRange("2026-01-01", "2026-12-31")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("the same period last year follows the organization's calendar", () => {
    expect(lastYearRange("2026-03-01", "2026-03-31", "AD")).toEqual({ from: "2025-03-01", to: "2025-03-31" });
    // Shrawan 1 2083 BS is mid-July 2026: a year earlier is Shrawan 1 2082, mid-July 2025
    const y = lastYearRange("2026-07-17", "2026-08-16", "BS");
    expect(y.from.slice(0, 4)).toBe("2025");
  });
});

describe("change", () => {
  it("revenue up is good and down is bad; costs are the other way round", () => {
    expect(changeOf(120, 100, "income")).toMatchObject({ pct: 20, direction: "up", good: true });
    expect(changeOf(80, 100, "income")).toMatchObject({ pct: -20, direction: "down", good: false });
    expect(changeOf(120, 100, "cost")).toMatchObject({ direction: "up", good: false });
    expect(changeOf(80, 100, "cost")).toMatchObject({ direction: "down", good: true });
  });
  it("gives no percentage, and no judgement, when there is nothing to compare with", () => {
    expect(changeOf(500, 0, "income")).toMatchObject({ pct: null, good: null, direction: "up" });
    expect(changeOf(100, 100, "income")).toMatchObject({ direction: "flat", good: null });
  });
  it("measures a loss against the size of the earlier figure, not its sign", () => {
    expect(changeOf(-50, -100, "income").pct).toBe(50); // the loss halved
  });
});

describe("monthly history", () => {
  const rows: DayAmounts[] = [];
  // 12 finished months of January 2025 to December 2025 at a steady 1,000 revenue, and a part month of 400 in January 2026
  for (let m = 1; m <= 12; m++) rows.push(day(`2025-${String(m).padStart(2, "0")}-15`, 1000, 300, 200));
  rows.push(day("2026-01-10", 400, 100, 50));

  it("lists the months up to the one holding the anchor, and marks the running month as partial", () => {
    const s = monthlySeries(rows, "2026-01-20", 13, "AD");
    expect(s).toHaveLength(13);
    expect(s[0].from).toBe("2025-01-01");
    expect(s[12]).toMatchObject({ from: "2026-01-01", to: "2026-01-31", revenue: 400, partial: true });
    expect(s.slice(0, 12).every((m) => !m.partial)).toBe(true);
  });
});

describe("expectation", () => {
  it("says nothing with fewer than six finished months", () => {
    expect(project([100, 100, 100, 100, 100], 3)).toBeNull();
  });
  it("is the average month times three, with a range of one swing either side", () => {
    const p = project([900, 1100, 900, 1100, 900, 1100], 3)!;
    expect(p).toMatchObject({ basis: 6, perMonth: 1000, expected: 3000 });
    expect(p.low).toBeLessThan(3000);
    expect(p.high).toBeGreaterThan(3000);
    expect(project([1000, 1000, 1000, 1000, 1000, 1000], 3)).toMatchObject({ expected: 3000, low: 3000, high: 3000 }); // no swing, no range
  });
  it("uses at most the last twelve months, and never expects a negative amount for revenue or costs", () => {
    const long = [...Array(10).fill(100), ...Array(12).fill(1000)];
    expect(project(long, 3)).toMatchObject({ basis: 12, perMonth: 1000 });
    expect(project([10, 0, 5, 0, 8, 0], 3, true)!.low).toBe(0);
    expect(project([-100, -300, -200, -100, -300, -200], 3, false)!.expected).toBe(-600); // a loss stays a loss for profit
  });
});

describe("the whole view", () => {
  const rows: DayAmounts[] = [];
  for (let m = 1; m <= 12; m++) rows.push(day(`2025-${String(m).padStart(2, "0")}-15`, 1000, 300, 200));
  for (let m = 1; m <= 6; m++) rows.push(day(`2026-${String(m).padStart(2, "0")}-15`, 1200, 300, 200));

  it("compares the period with the one before and with a year ago, and expects the next three months", () => {
    const v = buildPerformance({ rows, from: "2026-06-01", to: "2026-06-30", today: "2026-07-05", calendar: "AD" });
    expect(v.current).toEqual({ revenue: 1200, cogs: 300, expenses: 200, gross: 900, net: 700 });
    expect(v.previous.totals.revenue).toBe(1200); // May
    expect(v.lastYear.totals.revenue).toBe(1000); // June 2025
    expect(v.changes.lastYear.revenue).toMatchObject({ pct: 20, good: true });
    expect(v.changes.previous.revenue).toMatchObject({ direction: "flat" });
    expect(v.series).toHaveLength(12);
    expect(v.projection.revenue).toMatchObject({ basis: 12, expected: expect.any(Number) });
    expect(v.nextMonths.map((m) => m.label)).toEqual(["Jul 2026", "Aug 2026", "Sep 2026"]);
  });

  it("says there is not enough history when the business is new", () => {
    const v = buildPerformance({ rows: [day("2026-06-10", 500)], from: "2026-06-01", to: "2026-06-30", today: "2026-06-30", calendar: "AD" });
    expect(v.projection.revenue).toBeNull();
    expect(v.projection.net).toBeNull();
  });
});
