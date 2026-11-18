import { describe, expect, it } from "vitest";
import { entryProblem, incentivePay, suggestPeriodLabel } from "./incentive-rules";
import { computeMonthlyTds } from "./salary-tax-calc";

const headings = [
  { id: "h-sales", name: "Sales incentive", taxable: true, countsForRetirement: false },
  { id: "h-attend", name: "Attendance bonus", taxable: false, countsForRetirement: false },
  { id: "h-retire", name: "Counted incentive", taxable: true, countsForRetirement: true },
];

describe("incentive pay", () => {
  it("adds several entries under one heading and keeps headings apart, for that employee only", () => {
    const entries = [
      { employeeId: "e1", headingId: "h-sales", amount: 5000 },
      { employeeId: "e1", headingId: "h-sales", amount: 2500.5 },
      { employeeId: "e1", headingId: "h-attend", amount: 1000 },
      { employeeId: "e2", headingId: "h-sales", amount: 9999 },
    ];
    const pay = incentivePay("e1", entries, headings);
    expect(pay.lines).toEqual([
      { headingId: "h-attend", name: "Attendance bonus", amount: 1000, taxable: false, countsForRetirement: false },
      { headingId: "h-sales", name: "Sales incentive", amount: 7500.5, taxable: true, countsForRetirement: false },
    ]);
    expect(pay).toMatchObject({ total: 8500.5, taxable: 7500.5, retirement: 0 });
  });

  it("counts toward retirement only for headings marked so, and ignores unknown headings", () => {
    const pay = incentivePay("e1", [{ employeeId: "e1", headingId: "h-retire", amount: 3000 }, { employeeId: "e1", headingId: "gone", amount: 50 }], headings);
    expect(pay).toMatchObject({ total: 3000, taxable: 3000, retirement: 3000 });
  });

  it("someone with nothing gets nothing", () => {
    expect(incentivePay("e9", [{ employeeId: "e1", headingId: "h-sales", amount: 100 }], headings)).toEqual({ lines: [], total: 0, taxable: 0, retirement: 0 });
  });
});

describe("round entries and labels", () => {
  it("names the first problem in plain words", () => {
    expect(entryProblem([{ employeeId: "e1", amount: 100, note: "" }])).toBeNull();
    expect(entryProblem([{ employeeId: "", amount: 100, note: "" }])).toBe("Row 1: choose the employee.");
    expect(entryProblem([{ employeeId: "e1", amount: 100, note: "" }, { employeeId: "e2", amount: 0, note: "" }])).toBe("Row 2: enter an amount above zero.");
    expect(entryProblem([{ employeeId: "e1", amount: 100, note: "" }, { employeeId: "e2", amount: 50, note: "" }, { employeeId: "e1", amount: 25, note: "" }])).toBe("Row 3: this employee is already in row 1. Put the whole amount in one row.");
  });

  it("suggests a period label from the frequency", () => {
    expect(suggestPeriodLabel("monthly", "Kartik", 2083, 8)).toBe("Kartik 2083");
    expect(suggestPeriodLabel("quarterly", "Kartik", 2083, 8)).toBe("Quarter 3 2083");
    expect(suggestPeriodLabel("half_yearly", "Kartik", 2083, 8)).toBe("Half 2 2083");
    expect(suggestPeriodLabel("yearly", "Kartik", 2083, 8)).toBe("Year 2083");
    expect(suggestPeriodLabel("one_off", "Kartik", 2083, 8)).toBe("");
  });
});

describe("salary tax on one-off pay", () => {
  const slabs = [
    { upTo: 500000, rate: 1 },
    { upTo: 700000, rate: 10 },
    { upTo: 1000000, rate: 20 },
    { upTo: null, rate: 30 },
  ];
  const base = { earnedBefore: 0, withheldBefore: 0, priorIncome: 0, priorTds: 0, monthsLeft: 6, slabs, rounding: "none" };

  it("projects a one-month incentive once, not once for every month left", () => {
    const naive = computeMonthlyTds({ ...base, taxablePay: 60000 });
    const oneOff = computeMonthlyTds({ ...base, taxablePay: 60000, oneOffPay: 20000 });
    expect(naive.projected).toBe(360000);
    expect(oneOff.projected).toBe(40000 * 6 + 20000);
    expect(oneOff.tds).toBeLessThan(naive.tds + 0.005);
  });

  it("changes nothing when there is no one-off pay", () => {
    expect(computeMonthlyTds({ ...base, taxablePay: 60000, oneOffPay: 0 })).toEqual(computeMonthlyTds({ ...base, taxablePay: 60000 }));
  });
});
