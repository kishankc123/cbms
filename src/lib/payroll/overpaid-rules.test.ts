import { describe, expect, it } from "vitest";
import { overpaidAdjustment, overpaidOf } from "./overpaid-rules";

describe("overpaid staff", () => {
  it("does not count an advance that is still waiting for its payroll month", () => {
    expect(overpaidOf(-8000, 8000)).toBe(0);
    expect(overpaidOf(25000, 5000)).toBe(0);
  });

  it("counts what is owed back beyond the waiting advances", () => {
    expect(overpaidOf(-2000, 0)).toBe(2000); // an advance larger than the salary, after that month's payroll
    expect(overpaidOf(-3000, 0)).toBe(3000); // a salary payment above what was owed
    expect(overpaidOf(-7000, 5000)).toBe(2000);
    expect(overpaidOf(0, 0)).toBe(0);
  });
});

describe("what a payslip takes off for earlier overpayment", () => {
  it("takes the earlier excess, but never more than the pay", () => {
    expect(overpaidAdjustment(-3000, 0, 12000)).toBe(3000);
    expect(overpaidAdjustment(-15000, 0, 12000)).toBe(12000);
    expect(overpaidAdjustment(4000, 0, 12000)).toBe(0);
  });

  it("leaves advances to the advance recovery line", () => {
    expect(overpaidAdjustment(-14000, 14000, 0)).toBe(0);
    expect(overpaidAdjustment(-9000, 6000, 12000)).toBe(3000);
  });
});
