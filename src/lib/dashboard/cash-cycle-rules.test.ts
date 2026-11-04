import { describe, expect, it } from "vitest";
import { cycleOf, type CycleInputs } from "./cash-cycle-rules";

const base: CycleInputs = { receivables: 90000, sales: 270000, stock: 60000, costOfSales: 180000, payables: 30000, purchases: 120000, days: 90 };

describe("cash conversion cycle", () => {
  it("measures days to collect, hold stock and pay", () => {
    const c = cycleOf(base);
    expect(c.dso.days).toBe(30);
    expect(c.dio.days).toBe(30);
    expect(c.dpo.days).toBe(22.5);
    expect(c.cycleDays).toBe(37.5);
    expect(c.tiedUp).toBe(120000);
  });

  it("says what one day better is worth", () => {
    const c = cycleOf(base);
    expect(c.dso.perDay).toBe(3000);
    expect(c.dio.perDay).toBe(2000);
    expect(c.dpo.perDay).toBe(1333.33);
  });

  it("treats a business with no stock as holding it for no days", () => {
    const c = cycleOf({ ...base, stock: 0, costOfSales: 0 });
    expect(c.dio.days).toBe(0);
    expect(c.cycleDays).toBe(7.5);
  });

  it("cannot measure days when money is owed but nothing moved in the window", () => {
    const c = cycleOf({ ...base, sales: 0 });
    expect(c.dso.days).toBeNull();
    expect(c.cycleDays).toBeNull();
  });

  it("is zero when nothing is owed", () => {
    expect(cycleOf({ ...base, receivables: 0, sales: 0 }).dso.days).toBe(0);
  });
});
