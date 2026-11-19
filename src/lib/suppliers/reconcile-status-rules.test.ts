import { describe, expect, it } from "vitest";
import { addDays, coverage, reconciledOn } from "./reconcile-status-rules";

describe("how far a supplier is reconciled", () => {
  it("joins periods that touch or overlap and reports the last day covered", () => {
    const c = coverage([{ from: "2026-04-01", to: "2026-06-30" }, { from: "2026-07-01", to: "2026-09-30" }, { from: "2026-08-01", to: "2026-08-31" }]);
    expect(c.merged).toEqual([{ from: "2026-04-01", to: "2026-09-30" }]);
    expect(c.through).toBe("2026-09-30");
    expect(c.gaps).toEqual([]);
  });

  it("reports a gap between signed-off periods", () => {
    const c = coverage([{ from: "2026-01-01", to: "2026-03-31" }, { from: "2026-07-01", to: "2026-09-30" }]);
    expect(c.through).toBe("2026-09-30");
    expect(c.gaps).toEqual([{ from: "2026-04-01", to: "2026-06-30" }]);
  });

  it("says nothing when no period is signed off", () => {
    expect(coverage([])).toEqual({ through: null, merged: [], gaps: [] });
  });

  it("knows whether a date was reconciled", () => {
    const p = [{ from: "2026-04-01", to: "2026-06-30" }];
    expect(reconciledOn(p, "2026-06-30")).toBe(true);
    expect(reconciledOn(p, "2026-07-01")).toBe(false);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
