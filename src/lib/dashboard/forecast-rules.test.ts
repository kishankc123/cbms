import { describe, expect, it } from "vitest";
import { buildForecast, collectionDate, customerHabits, fixedMonthly, parseHorizon, paymentDate, payrollEvents, reserveOf, usualDaysToPay, workingCapitalOf, type ForecastEvent, type SettledInvoice } from "./forecast-rules";

const today = "2026-11-03";
const ev = (p: Partial<ForecastEvent> & Pick<ForecastEvent, "date" | "amount" | "side">): ForecastEvent => ({ id: Math.random().toString(), category: p.side === "in" ? "collections" : "supplier_payments", party: "x", basis: "due_date", certainty: "confirmed", ...p });
const settled = (customerId: string, n: number, due: string, paid: string, amount = 1000): SettledInvoice => ({ customerId, invoiceId: `${customerId}-${n}`, amount, docDate: "2026-01-01", dueDate: due, paidDate: paid });

describe("when customers pay", () => {
  it("learns the usual days to pay across everyone, weighted by size", () => {
    const h = [settled("a", 1, "2026-02-01", "2026-01-11", 3000), settled("b", 1, "2026-02-01", "2026-01-31", 1000)];
    expect(usualDaysToPay(h)).toBe(15); // (10*3000 + 30*1000) / 4000
    expect(usualDaysToPay([])).toBeNull();
  });

  it("only gives a customer a habit after three settled invoices", () => {
    const two = [settled("a", 1, "2026-02-01", "2026-02-11"), settled("a", 2, "2026-03-01", "2026-03-11")];
    expect(customerHabits(two, 30).size).toBe(0);
    const three = [...two, settled("a", 3, "2026-04-01", "2026-04-11")];
    expect(customerHabits(three, 30).get("a")).toEqual({ lagDays: 10, samples: 3 });
  });

  it("uses the due date when nothing else is known", () => {
    expect(collectionDate({ dueDate: "2026-11-20", docDate: "2026-10-20", today, habit: null, defaultDays: 30 })).toEqual({ date: "2026-11-20", basis: "due_date" });
  });

  it("falls back to the invoice date plus the usual days when there is no due date", () => {
    expect(collectionDate({ dueDate: null, docDate: "2026-11-01", today, habit: null, defaultDays: 30 })).toEqual({ date: "2026-12-01", basis: "default" });
  });

  it("shifts by the customer's own habit", () => {
    expect(collectionDate({ dueDate: "2026-11-20", docDate: "2026-10-20", today, habit: { lagDays: 12, samples: 4 }, defaultDays: 30 })).toEqual({ date: "2026-12-02", basis: "customer_pattern" });
  });

  it("assumes an overdue invoice is paid within a week", () => {
    expect(collectionDate({ dueDate: "2026-09-01", docDate: "2026-08-01", today, habit: null, defaultDays: 30 })).toEqual({ date: "2026-11-10", basis: "overdue" });
    expect(paymentDate({ dueDate: "2026-09-01", docDate: "2026-08-01", today })).toEqual({ date: "2026-11-10", basis: "overdue" });
    expect(paymentDate({ dueDate: "2026-11-15", docDate: "2026-10-01", today })).toEqual({ date: "2026-11-15", basis: "due_date" });
  });
});

describe("payroll", () => {
  it("repeats the last month's pay for each period ending in the horizon", () => {
    const last = { periodStart: "2026-10-01", periodEnd: "2026-10-31", total: 50000 };
    const out = payrollEvents(last, today, "2026-12-31");
    expect(out.map((e) => e.date)).toEqual(["2026-12-08"]); // the next period ends about Dec 1; paid 7 days later
  });

  it("is empty with no finalised run", () => {
    expect(payrollEvents(null, today, "2026-12-31")).toEqual([]);
  });
});

describe("the reserve", () => {
  it("is months of fixed expenses unless overridden", () => {
    expect(reserveOf({ months: 3, override: null }, 40000)).toMatchObject({ amount: 120000 });
    expect(reserveOf({ months: 3, override: 90000 }, 40000)).toMatchObject({ amount: 90000 });
  });

  it("works fixed expenses out from the last 3 months, else the recurring definitions", () => {
    expect(fixedMonthly(50000, 10000)).toBe(50000);
    expect(fixedMonthly(0, 10000)).toBe(10000);
  });
});

describe("working capital", () => {
  it("is current assets less current liabilities", () => {
    const w = workingCapitalOf({ cash: 100000, receivables: 50000, stock: 30000, payables: 40000, salaryPayable: 20000, taxPayable: 10000 });
    expect(w).toMatchObject({ currentAssets: 180000, currentLiabilities: 70000, workingCapital: 110000 });
  });
});

describe("the forecast", () => {
  it("rolls the balance forward day by day and finds the lowest point", () => {
    const f = buildForecast({
      today,
      horizonDays: 10,
      openingCash: 10000,
      reserve: 5000,
      events: [ev({ side: "out", date: "2026-11-05", amount: 8000 }), ev({ side: "in", date: "2026-11-09", amount: 20000 })],
    });
    expect(f.days).toHaveLength(11);
    expect(f.lowest).toEqual({ date: "2026-11-05", balance: 2000 });
    expect(f.endBalance).toBe(22000);
    expect(f.availableToPlan).toBe(-3000);
    expect(f.totalIn).toBe(20000);
    expect(f.totalOut).toBe(8000);
  });

  it("warns when cash falls below the reserve and when it runs out", () => {
    const f = buildForecast({ today, horizonDays: 10, openingCash: 6000, reserve: 5000, events: [ev({ side: "out", date: "2026-11-04", amount: 2000 }), ev({ side: "out", date: "2026-11-08", amount: 9000 })] });
    expect(f.warnings.map((w) => [w.level, w.date])).toEqual([["critical", "2026-11-08"], ["action", "2026-11-04"]]);
  });

  it("leaves out events past the horizon or before today", () => {
    const f = buildForecast({ today, horizonDays: 7, openingCash: 1000, reserve: 0, events: [ev({ side: "in", date: "2026-11-20", amount: 5000 }), ev({ side: "in", date: "2026-11-01", amount: 5000 })] });
    expect(f.endBalance).toBe(1000);
    expect(f.byCategory).toEqual([]);
  });

  it("sums by category", () => {
    const f = buildForecast({ today, horizonDays: 10, openingCash: 0, reserve: 0, events: [ev({ side: "in", date: "2026-11-05", amount: 100 }), ev({ side: "in", date: "2026-11-06", amount: 50 })] });
    expect(f.byCategory).toEqual([{ key: "collections", label: "Customer collections", side: "in", amount: 150, count: 2 }]);
  });

  it("reads the horizon from the address, falling back to 30 days", () => {
    expect(parseHorizon("60")).toBe(60);
    expect(parseHorizon("0")).toBe(30);
    expect(parseHorizon("9999")).toBe(30);
    expect(parseHorizon(undefined)).toBe(30);
  });
});
