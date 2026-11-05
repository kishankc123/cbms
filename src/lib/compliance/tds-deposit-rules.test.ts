import { describe, expect, it } from "vitest";
import { depositStatus, positionByHeading, uncoveredRows, type DepositMonthRow } from "./tds-deposit-rules";

const row = (over: Partial<DepositMonthRow>): DepositMonthRow => ({ obligationId: "o1", period: "Poush 2082", periodStart: "2026-01-01", periodEnd: "2026-01-31", headKey: "payroll", heading: "Payroll", withheld: 1000, deposited: 0, remaining: 1000, status: "none", fine: null, ...over });

describe("deposit status", () => {
  it("is deposited when nothing is left, part when some is, none when none is", () => {
    expect(depositStatus(1000, 1000, true)).toBe("deposited");
    expect(depositStatus(1000, 400, true)).toBe("part");
    expect(depositStatus(1000, 0, true)).toBe("none");
    expect(depositStatus(1000, 1200, true)).toBe("deposited"); // over-deposited still counts as deposited
  });
  it("says there is no deposit item when the period has none, whatever the amounts", () => {
    expect(depositStatus(1000, 0, false)).toBe("no_item");
  });
});

describe("position by heading", () => {
  it("adds the periods up per heading, keeping each period's own remaining amount", () => {
    const rows = [
      row({ withheld: 1000, deposited: 1000, remaining: 0, status: "deposited" }),
      row({ periodStart: "2026-02-01", period: "Magh 2082", withheld: 1000, deposited: 300, remaining: 700, status: "part" }),
      row({ headKey: "rent", heading: "Rent", withheld: 500, deposited: 500, remaining: 0, status: "deposited" }),
    ];
    const p = positionByHeading(rows);
    expect(p).toEqual([
      { headKey: "payroll", heading: "Payroll", withheld: 2000, deposited: 1300, remaining: 700, status: "part", fine: null },
      { headKey: "rent", heading: "Rent", withheld: 500, deposited: 500, remaining: 0, status: "deposited", fine: null },
    ]);
  });

  it("an over-deposit in one month does not reduce what another month still owes", () => {
    const p = positionByHeading([row({ withheld: 1000, deposited: 1500, remaining: 0, status: "deposited" }), row({ periodStart: "2026-02-01", withheld: 1000, deposited: 0, remaining: 1000, status: "none" })]);
    expect(p[0]).toMatchObject({ withheld: 2000, deposited: 1500, remaining: 1000, status: "part" });
  });

  it("a heading with a month nobody made a deposit item for is flagged", () => {
    const gap = uncoveredRows([{ date: "2026-03-05", tds: 400, headKey: "rent" }], [{ periodStart: "2026-01-01", periodEnd: "2026-01-31" }], (k) => (k === "rent" ? "Rent" : "Not assigned"));
    expect(positionByHeading(gap)[0]).toMatchObject({ heading: "Rent", withheld: 400, remaining: 400, status: "no_item" });
  });
});

describe("withheld in months with no deposit item", () => {
  const periods = [{ periodStart: "2026-01-01", periodEnd: "2026-01-31" }];
  it("groups only what falls outside every deposit item by month and heading", () => {
    const rows = uncoveredRows(
      [
        { date: "2026-01-15", tds: 100, headKey: "rent" }, // covered
        { date: "2026-03-05", tds: 400, headKey: "rent" },
        { date: "2026-03-20", tds: 100, headKey: "rent" },
        { date: "2026-03-20", tds: 50, headKey: null },
        { date: "2026-03-21", tds: 0, headKey: "rent" }, // nothing withheld
      ],
      periods,
      (k) => (k === "rent" ? "Rent" : "Not assigned")
    );
    expect(rows.map((r) => [r.period, r.heading, r.withheld, r.status, r.obligationId])).toEqual([
      ["2026-03 (no deposit item)", "Rent", 500, "no_item", null],
      ["2026-03 (no deposit item)", "Not assigned", 50, "no_item", null],
    ]);
  });
});
