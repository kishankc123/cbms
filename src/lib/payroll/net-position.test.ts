import { describe, expect, it } from "vitest";
import { netPosition } from "./net-position";

describe("an employee's salary and advance set against each other", () => {
  it("shows what the company still owes after the advance", () => {
    expect(netPosition(30000, 10000)).toEqual({ salaryOwed: 30000, advanceHeld: 10000, amount: 20000, side: "company_owes" });
  });
  it("shows what the employee owes when the advance is more than the salary owed", () => {
    expect(netPosition(5000, 12000)).toMatchObject({ amount: 7000, side: "employee_owes" });
  });
  it("is even when they cancel", () => {
    expect(netPosition(8000, 8000)).toMatchObject({ amount: 0, side: "even" });
    expect(netPosition(0, 0).side).toBe("even");
  });
});
