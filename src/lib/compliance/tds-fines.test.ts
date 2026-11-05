import { describe, expect, it } from "vitest";
import { calculatePenalty, type TdsPenaltyParams } from "./penalty-engine";
import { sumFines, tdsFinesByHeading, tranchesFor } from "./tds-fines";

// Round figures so the arithmetic can be checked by hand: Rs 100 a day, a 10% yearly filing fee and 10% yearly interest.
const params: TdsPenaltyParams = { filingFlatPerDay: 100, filingAnnualRate: 0.1, interestAnnualRate: 0.1 };
const due = "2026-02-25";

describe("tranches", () => {
  it("counts each deposit on its own day, never more than was withheld, and the rest to the report date", () => {
    expect(tranchesFor(1000, [{ amount: 300, date: "2026-03-10" }, { amount: 200, date: "2026-03-01" }], "2026-04-01")).toEqual([
      { amount: 200, date: "2026-03-01" },
      { amount: 300, date: "2026-03-10" },
      { amount: 500, date: "2026-04-01" },
    ]);
    // an over-deposit is cut to what was withheld, and nothing is left over
    expect(tranchesFor(1000, [{ amount: 1200, date: "2026-02-20" }], "2026-04-01")).toEqual([{ amount: 1000, date: "2026-02-20" }]);
    expect(tranchesFor(0, [], "2026-04-01")).toEqual([]);
  });
});

describe("fines by heading", () => {
  it("one heading paying everything on one day matches the single-figure calculator exactly", () => {
    const f = tdsFinesByHeading([{ key: "rent", tranches: [{ amount: 10000, date: "2026-03-27" }] }], due, params).get("rent")!; // 30 days late
    const whole = calculatePenalty("tds", 10000, due, "2026-03-27", params);
    expect(f.daysLate).toBe(30);
    expect(f.flat).toBe(3000);
    expect(f.flat + f.volumeFee).toBe(whole.filingPenalty);
    expect(f.interest).toBe(whole.interest);
    expect(f.total).toBe(whole.filingPenalty + whole.interest);
  });

  it("charges the filing fee and interest to each heading, and shares the one flat fine by how much was late", () => {
    const out = tdsFinesByHeading(
      [
        { key: "payroll", tranches: [{ amount: 30000, date: "2026-03-27" }] }, // 30 days late
        { key: "rent", tranches: [{ amount: 10000, date: "2026-03-27" }] },
      ],
      due,
      params
    );
    const [a, b] = [out.get("payroll")!, out.get("rent")!];
    // the flat fine is charged once for the return: 100 x 30 = 3,000, shared 3 to 1
    expect(a.flat + b.flat).toBe(3000);
    expect([a.flat, b.flat]).toEqual([2250, 750]);
    // interest is on each heading's own amount: 30,000 x 10% x 30/365 and 10,000 x 10% x 30/365
    expect(a.interest).toBe(246.58);
    expect(b.interest).toBe(82.19);
    expect(a.volumeFee).toBe(246.58);
  });

  it("an amount deposited on time owes nothing, and part-late amounts owe only for the days they were late", () => {
    const out = tdsFinesByHeading(
      [
        { key: "payroll", tranches: [{ amount: 5000, date: "2026-02-20" }] }, // on time
        { key: "rent", tranches: [{ amount: 4000, date: "2026-02-25" }, { amount: 6000, date: "2026-03-07" }] }, // 10 days late for 6,000
      ],
      due,
      params
    );
    expect(out.get("payroll")).toEqual({ daysLate: 0, flat: 0, volumeFee: 0, interest: 0, total: 0 });
    const rent = out.get("rent")!;
    expect(rent.daysLate).toBe(10);
    expect(rent.flat).toBe(1000); // the whole return was late for 10 days, all of it rent's
    expect(rent.interest).toBe(16.44); // 6,000 x 10% x 10/365
  });

  it("charges the flat fine once even when several headings are late, and the shares add up to it exactly", () => {
    const heads = ["a", "b", "c"].map((k) => ({ key: k, tranches: [{ amount: 3333.33, date: "2026-03-06" }] })); // 9 days late
    const out = tdsFinesByHeading(heads, due, params);
    expect(sumFines([...out.values()]).flat).toBe(900);
  });

  it("is all zero for a deposit item that is not yet due, or has nothing late", () => {
    const out = tdsFinesByHeading([{ key: "rent", tranches: [{ amount: 8000, date: "2026-02-10" }] }], due, params);
    expect(out.get("rent")!.total).toBe(0);
  });
});
